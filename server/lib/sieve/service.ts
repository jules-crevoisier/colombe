/**
 * Façade filtres/vacance/transfert pour les routes /api/filters/* : choisit
 * le vrai client ManageSieve ou le mock (MAIL_BACKEND), applique les règles
 * de sécurité (domaines de transfert, confirmation), et génère/relit les
 * scripts via generate.ts / parse-json.ts.
 *
 * Les identifiants viennent du même magasin que l'IMAP (server/lib/session/credentials.ts) :
 * rien ne passe par le navigateur.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Error, H3Event } from 'h3'
import { createError, isError } from 'h3'
import type {
  FilterRule,
  FilterSet,
  FilterSetSummary,
  FiltersStatus,
  ForwardSettings,
  SecurityConfirmation,
  VacationSettings,
} from '#shared/types/mail'
import { freshCredentials } from '../auth/oidc/session'
import { verifySecondFactor } from '../auth/second-factor'
import { getConfig } from '../config'
import type { MailSsoConfig } from '../config'
import { createBackend } from '../mail/index'
import { buildRawMessage } from '../mail/compose'
import { credentialsStore } from '../session/credentials'
import { loginLimiter } from '../session/rate-limit'
import { sievePool } from '../session/sieve-pool'
import { useDb } from '../store/db'
import { isTwoFactorEnabled } from '../store/twofactor'
import { mailConfig } from '../../utils/mail-session'
import { hasRecentSsoReauth, sieveCredentials } from './auth'
import { SieveClient, SieveError, type SieveErrorCode } from './client'
import { generateScript, isAllowedForwardTarget, SieveGenerateError } from './generate'
import { MockSieveSession, resetSieveMock } from './mock'
import { readManagedData } from './parse-json'
import { findForbiddenDirectives } from './scan'

export { resetSieveMock }

export interface FiltersContext {
  event: H3Event
  email: string
  sid: string
}

/** Contrat minimal commun au vrai client ManageSieve et au mock. */
export interface SieveSessionLike {
  capabilities(): string[]
  listScripts(): Promise<{ name: string; active: boolean }[]>
  getScript(name: string): Promise<string>
  putScript(name: string, content: string): Promise<void>
  checkScript(content: string): Promise<void>
  setActive(name: string): Promise<void>
  deleteScript(name: string): Promise<void>
  close(): Promise<void>
}

export interface SieveRuntimeConfig {
  kind: 'mock' | 'real'
  /** false : ManageSieve désactivé côté serveur (MAIL_SIEVE_ENABLED=false) — jamais de connexion tentée. */
  enabled: boolean
  host: string
  port: number
  rejectUnauthorized: boolean
  servername: string
  forwardDomains: string[]
  /** Identifiant présenté au serveur ManageSieve pour une adresse (voir ColombeConfig.login.username). */
  loginUsername: 'email' | 'localpart'
  /** Accès des sessions OIDC (MAIL_SSO_AUTH). */
  mailSso: MailSsoConfig | null
}

export function sieveRuntimeConfig(_event: H3Event): SieveRuntimeConfig {
  const c = getConfig()
  return {
    kind: c.backend === 'mock' ? 'mock' : 'real',
    enabled: c.sieve.enabled,
    host: c.sieve.host,
    servername: c.sieve.servername,
    port: c.sieve.port,
    rejectUnauthorized: c.tlsRejectUnauthorized,
    forwardDomains: c.forwardDomains,
    loginUsername: c.login.username,
    mailSso: c.mailSso,
  }
}

export async function openSieveSession(
  event: H3Event,
  sid: string,
  email: string
): Promise<{ available: boolean; session: SieveSessionLike | null; capabilities: string[] }> {
  const cfg = sieveRuntimeConfig(event)
  if (!cfg.enabled) {
    return { available: false, session: null, capabilities: [] }
  }
  if (cfg.kind === 'mock') {
    const session = new MockSieveSession(email)
    return { available: true, session, capabilities: session.capabilities() }
  }
  const creds = await freshCredentials(sid)
  if (!creds) {
    throw createError({ statusCode: 401, statusMessage: 'Session expirée', message: 'Session expirée' })
  }
  try {
    const client = await SieveClient.connect(
      { host: cfg.host, port: cfg.port, rejectUnauthorized: cfg.rejectUnauthorized, servername: cfg.servername },
      sieveCredentials(creds, cfg)
    )
    return { available: true, session: client, capabilities: client.sieveExtensions() }
  } catch (err) {
    if (err instanceof SieveError && err.code === 'CONNECT_FAILED') {
      return { available: false, session: null, capabilities: [] }
    }
    throw err
  }
}

/**
 * Ouvre une session (mock : une par appel, comme avant ; réel : une par sid,
 * réutilisée et sérialisée via `sievePool` — voir server/lib/session/sieve-pool.ts)
 * et y exécute `fn`. Ne lance pas si le serveur de filtres est indisponible :
 * renvoie `{ available: false }`, à l'appelant de décider (throw ou réponse dégradée).
 */
async function withSessionOrUnavailable<T>(
  ctx: FiltersContext,
  fn: (session: SieveSessionLike, capabilities: string[]) => Promise<T>
): Promise<{ available: true; result: T } | { available: false }> {
  const cfg = sieveRuntimeConfig(ctx.event)
  if (cfg.kind === 'mock') {
    const { available, session, capabilities } = await openSieveSession(ctx.event, ctx.sid, ctx.email)
    if (!available || !session) return { available: false }
    try {
      return { available: true, result: await fn(session, capabilities) }
    } finally {
      await session.close().catch(() => { /* ignore */ })
    }
  }
  return sievePool.run(ctx.sid, () => openSieveSession(ctx.event, ctx.sid, ctx.email), fn)
}

async function withAvailableSession<T>(
  ctx: FiltersContext,
  fn: (session: SieveSessionLike, capabilities: string[]) => Promise<T>
): Promise<T> {
  const outcome = await withSessionOrUnavailable(ctx, fn)
  if (!outcome.available) {
    throw new SieveError('CONNECT_FAILED', 'Les filtres ne sont pas disponibles sur ce serveur.')
  }
  return outcome.result
}

/** Lit un script en passant par le cache par sid (`sievePool`) : évite un GETSCRIPT
 * si le contenu est déjà connu depuis la dernière écriture (voir invalidations ci-dessous). */
async function readScript(ctx: FiltersContext, session: SieveSessionLike, name: string): Promise<string> {
  const cached = sievePool.getCachedScript(ctx.sid, name)
  if (cached !== undefined) return cached
  const content = await session.getScript(name)
  sievePool.setCachedScript(ctx.sid, name, content)
  return content
}

async function checkThenPut(ctx: FiltersContext, session: SieveSessionLike, name: string, content: string): Promise<void> {
  await session.checkScript(content)
  await session.putScript(name, content)
  // On connaît déjà le contenu qu'on vient d'écrire : autant amorcer le cache que l'invalider.
  sievePool.setCachedScript(ctx.sid, name, content)
}

function emptyVacation(email: string): VacationSettings {
  return {
    enabled: false,
    from: null,
    until: null,
    subject: '',
    message: '',
    days: 7,
    addresses: [],
    replyFrom: email,
    incoming: 'keep',
    incomingAddress: null,
  }
}

function emptyForward(): ForwardSettings {
  return { enabled: false, address: '', keepCopy: true }
}

interface ActiveSetInfo {
  name: string
  managed: boolean
  rules: FilterRule[]
  vacation: VacationSettings | null
  forward: ForwardSettings | null
}

async function loadActiveSet(ctx: FiltersContext, session: SieveSessionLike): Promise<ActiveSetInfo | null> {
  const scripts = await session.listScripts()
  const activeEntry = scripts.find((s) => s.active)
  if (!activeEntry) return null
  const content = await readScript(ctx, session, activeEntry.name)
  const parsed = readManagedData(content)
  return {
    name: activeEntry.name,
    managed: parsed !== null,
    rules: parsed?.rules ?? [],
    vacation: parsed?.vacation ?? null,
    forward: parsed?.forward ?? null,
  }
}

function containsSensitiveAction(rules: FilterRule[]): boolean {
  return rules.some((r) => r.enabled && r.actions.some((a) => a.type === 'redirect' || a.type === 'notify'))
}

function isSensitiveIncoming(v: VacationSettings | null): boolean {
  return v !== null && (v.incoming === 'redirect' || v.incoming === 'copy')
}

/** Confirmation requise si le transfert du courrier entrant apparaît ou change de destination. */
function needsVacationConfirmation(previous: VacationSettings | null, next: VacationSettings): boolean {
  const nextSensitive = next.incoming === 'redirect' || next.incoming === 'copy'
  if (!nextSensitive) return false
  if (!isSensitiveIncoming(previous)) return true
  return previous?.incomingAddress !== next.incomingAddress
}

function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest()
  const bh = createHash('sha256').update(b).digest()
  return timingSafeEqual(ah, bh)
}

const CONFIRMATION_REQUIRED = createError({
  statusCode: 403,
  statusMessage: 'Confirmation requise',
  message: 'Confirmez votre mot de passe.',
})

// ─── SSO (OIDC) : début ───
/** Session sans mot de passe (connexion unique) : la confirmation passe par le fournisseur. */
const SSO_CONFIRMATION_REQUIRED = createError({
  statusCode: 403,
  statusMessage: 'Confirmation requise',
  message: 'Confirmez votre identité auprès de votre établissement.',
})
// ─── SSO (OIDC) : fin ───

/**
 * Même limite que la connexion (5 essais / 15 min, clé distincte) : un cookie de
 * session volé ne doit pas permettre de deviner le mot de passe par ce biais.
 * Session par connexion unique (pas de mot de passe connu de Colombe) : code TOTP si
 * activé, sinon réauthentification récente chez le fournisseur d'identité.
 */
async function assertConfirmed(ctx: FiltersContext, confirm: SecurityConfirmation): Promise<void> {
  const key = `confirm:${ctx.email.toLowerCase()}`
  if (loginLimiter.isLimited(key)) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives', message: 'Trop de tentatives. Réessayez plus tard.' })
  }
  const creds = credentialsStore.get(ctx.sid)
  const passwordSession = creds?.auth.kind === 'password'
  // ─── SSO (OIDC) : début ───
  if (creds && !passwordSession && hasRecentSsoReauth(credentialsStore.getSso(ctx.sid)?.reauthAt, Date.now())) {
    loginLimiter.reset(key)
    return
  }
  // ─── SSO (OIDC) : fin ───
  const db = useDb()
  let ok = false
  if (confirm.totpCode && isTwoFactorEnabled(db, ctx.email)) {
    ok = verifySecondFactor(db, ctx.email, confirm.totpCode, { requireEnabled: true, allowRecovery: true })
  }
  else if (confirm.confirmPassword && creds?.auth.kind === 'password') {
    ok = constantTimeEqual(confirm.confirmPassword, creds.auth.password)
  }
  if (ok) {
    loginLimiter.reset(key)
    return
  }
  if (confirm.totpCode || confirm.confirmPassword) loginLimiter.hit(key)
  throw creds && !passwordSession ? SSO_CONFIRMATION_REQUIRED : CONFIRMATION_REQUIRED
}

const UNMANAGED_SET = createError({
  statusCode: 409,
  statusMessage: 'Ensemble modifié à la main',
  message: 'Ce jeu de filtres a été modifié à la main.',
})

function notFound(message = 'Jeu de filtres introuvable.'): H3Error {
  return createError({ statusCode: 404, statusMessage: 'Introuvable', message })
}

// ─── Statut ───

export async function getFiltersStatus(ctx: FiltersContext): Promise<FiltersStatus> {
  const outcome = await withSessionOrUnavailable(ctx, async (session, capabilities) => {
    const scripts = await session.listScripts()
    const sets: FilterSetSummary[] = []
    for (const s of scripts) {
      // En cache par sid depuis la dernière écriture (voir readScript) : sur une connexion
      // poolée, un GET /api/filters répété sans modification ne renvoie plus GETSCRIPT.
      const content = await readScript(ctx, session, s.name)
      sets.push({ name: s.name, active: s.active, managed: readManagedData(content) !== null })
    }
    return { capabilities, sets }
  })
  if (!outcome.available) return { available: false, capabilities: [], sets: [] }
  return { available: true, ...outcome.result }
}

// ─── Ensembles ───

export async function createFilterSet(ctx: FiltersContext, name: string, copyFrom?: string): Promise<FilterSet> {
  return withAvailableSession(ctx, async (session, capabilities) => {
    const cfg = sieveRuntimeConfig(ctx.event)
    const scripts = await session.listScripts()
    if (scripts.some((s) => s.name === name)) {
      throw createError({ statusCode: 409, statusMessage: 'Nom déjà utilisé', message: 'Un jeu de filtres porte déjà ce nom.' })
    }

    let script: string
    let rules: FilterRule[] = []
    if (copyFrom) {
      if (!scripts.some((s) => s.name === copyFrom)) throw notFound('Jeu de filtres source introuvable.')
      const sourceContent = await readScript(ctx, session, copyFrom)
      const data = readManagedData(sourceContent)
      if (data) {
        rules = data.rules
        script = generateScript({ rules, vacation: null, forward: null, capabilities }, cfg.forwardDomains)
      } else {
        script = sourceContent
      }
    } else {
      script = generateScript({ rules: [], vacation: null, forward: null, capabilities }, cfg.forwardDomains)
    }

    await checkThenPut(ctx, session, name, script)
    const managed = readManagedData(script) !== null
    return { name, active: false, managed, rules: managed ? rules : [], script }
  })
}

export async function getFilterSet(ctx: FiltersContext, name: string): Promise<FilterSet> {
  return withAvailableSession(ctx, async (session) => {
    const scripts = await session.listScripts()
    const entry = scripts.find((s) => s.name === name)
    if (!entry) throw notFound()
    const content = await readScript(ctx, session, name)
    const data = readManagedData(content)
    return { name, active: entry.active, managed: data !== null, rules: data?.rules ?? [], script: content }
  })
}

export async function updateFilterSetRules(
  ctx: FiltersContext,
  name: string,
  rules: FilterRule[],
  confirm: SecurityConfirmation
): Promise<FilterSet> {
  return withAvailableSession(ctx, async (session, capabilities) => {
    const cfg = sieveRuntimeConfig(ctx.event)
    const scripts = await session.listScripts()
    const entry = scripts.find((s) => s.name === name)
    if (!entry) throw notFound()
    const content = await readScript(ctx, session, name)
    const data = readManagedData(content)
    if (!data) throw UNMANAGED_SET

    const sensitive = containsSensitiveAction(rules)
    if (sensitive) await assertConfirmed(ctx, confirm)

    const script = generateScript({ rules, vacation: data.vacation, forward: data.forward, capabilities }, cfg.forwardDomains)
    await checkThenPut(ctx, session, name, script)

    if (sensitive) {
      await onForwardingChanged(ctx, ctx.email, `Règles de filtrage modifiées dans « ${name} » (redirection ou notification).`)
    }
    return { name, active: entry.active, managed: true, rules, script }
  })
}

export async function updateFilterSetScript(
  ctx: FiltersContext,
  name: string,
  script: string,
  confirm: SecurityConfirmation
): Promise<FilterSet> {
  return withAvailableSession(ctx, async (session) => {
    const cfg = sieveRuntimeConfig(ctx.event)
    const scripts = await session.listScripts()
    const entry = scripts.find((s) => s.name === name)
    if (!entry) throw notFound()

    const problems = findForbiddenDirectives(script, { forwardDomains: cfg.forwardDomains, loginEmail: ctx.email })
    if (problems.length > 0) {
      throw createError({ statusCode: 400, statusMessage: 'Script refusé', message: problems[0] })
    }

    // Un script à la main exige toujours la confirmation, quel que soit son contenu.
    await assertConfirmed(ctx, confirm)
    await checkThenPut(ctx, session, name, script)
    await onForwardingChanged(ctx, ctx.email, `Script de filtres modifié à la main (« ${name} »).`)

    const data = readManagedData(script)
    return { name, active: entry.active, managed: data !== null, rules: data?.rules ?? [], script }
  })
}

export async function activateFilterSet(ctx: FiltersContext, name: string): Promise<void> {
  await withAvailableSession(ctx, async (session) => {
    const scripts = await session.listScripts()
    if (!scripts.some((s) => s.name === name)) throw notFound()
    await session.setActive(name)
    sievePool.invalidateAllScripts(ctx.sid)
  })
}

export async function deactivateFilters(ctx: FiltersContext): Promise<void> {
  await withAvailableSession(ctx, async (session) => {
    await session.setActive('')
    sievePool.invalidateAllScripts(ctx.sid)
  })
}

export async function deleteFilterSet(ctx: FiltersContext, name: string): Promise<void> {
  await withAvailableSession(ctx, async (session) => {
    const scripts = await session.listScripts()
    const entry = scripts.find((s) => s.name === name)
    if (!entry) throw notFound()
    if (entry.active) {
      throw createError({ statusCode: 409, statusMessage: 'Ensemble actif', message: 'Impossible de supprimer le jeu de filtres actif.' })
    }
    await session.deleteScript(name)
    sievePool.invalidateScript(ctx.sid, name)
  })
}

export async function exportFilterSet(ctx: FiltersContext, name: string): Promise<{ filename: string; content: string }> {
  return withAvailableSession(ctx, async (session) => {
    const content = await readScript(ctx, session, name)
    return { filename: `${name}.sieve`, content }
  })
}

function sanitizeImportName(filename: string): string {
  const base = filename.replace(/\.sieve$/i, '').replace(/[\\/]/g, '_')
  const cleaned = base.replace(/[^A-Za-z0-9 _.-]/g, '_').trim().slice(0, 64)
  return cleaned || 'import'
}

export async function importFilterSet(
  ctx: FiltersContext,
  filename: string,
  content: string,
  confirm: SecurityConfirmation
): Promise<FilterSet> {
  return withAvailableSession(ctx, async (session) => {
    const cfg = sieveRuntimeConfig(ctx.event)
    const name = sanitizeImportName(filename)

    const problems = findForbiddenDirectives(content, { forwardDomains: cfg.forwardDomains, loginEmail: ctx.email })
    if (problems.length > 0) {
      throw createError({ statusCode: 400, statusMessage: 'Script refusé', message: problems[0] })
    }

    // Un script importé est écrit à la main : confirmation toujours exigée (PLAN-v4 F),
    // même sans redirection — `discard` ou `reject` suffisent à faire disparaître du courrier.
    await assertConfirmed(ctx, confirm)

    await checkThenPut(ctx, session, name, content)
    await onForwardingChanged(ctx, ctx.email, `Jeu de filtres importé depuis un script (« ${name} »).`)

    const data = readManagedData(content)
    return { name, active: false, managed: data !== null, rules: data?.rules ?? [], script: content }
  })
}

// ─── Réponse automatique et transfert (vivent dans l'ensemble actif) ───

export async function getVacation(ctx: FiltersContext): Promise<VacationSettings> {
  return withAvailableSession(ctx, async (session) => {
    const active = await loadActiveSet(ctx, session)
    return active?.vacation ?? emptyVacation(ctx.email)
  })
}

export async function putVacation(
  ctx: FiltersContext,
  settings: VacationSettings,
  confirm: SecurityConfirmation
): Promise<VacationSettings> {
  return withAvailableSession(ctx, async (session, capabilities) => {
    const cfg = sieveRuntimeConfig(ctx.event)
    if ((settings.incoming === 'redirect' || settings.incoming === 'copy')
      && (!settings.incomingAddress || !isAllowedForwardTarget(settings.incomingAddress, cfg.forwardDomains))) {
      throw createError({ statusCode: 400, statusMessage: 'Domaine interdit', message: 'Transfert interdit vers ce domaine.' })
    }

    const active = await loadActiveSet(ctx, session)
    if (active && !active.managed) throw UNMANAGED_SET
    const name = active?.name ?? 'colombe'

    const requiresConfirmation = needsVacationConfirmation(active?.vacation ?? null, settings)
    if (requiresConfirmation) await assertConfirmed(ctx, confirm)

    // L'adresse d'expédition de la réponse est toujours celle de connexion, jamais une valeur du client.
    const toSave: VacationSettings = { ...settings, replyFrom: ctx.email }
    const script = generateScript(
      { rules: active?.rules ?? [], vacation: toSave, forward: active?.forward ?? null, capabilities },
      cfg.forwardDomains
    )
    await checkThenPut(ctx, session, name, script)
    await session.setActive(name)
    sievePool.invalidateAllScripts(ctx.sid)

    if (requiresConfirmation) {
      const dest = toSave.incoming === 'copy' ? `copié vers ${toSave.incomingAddress}` : `redirigé vers ${toSave.incomingAddress}`
      await onForwardingChanged(ctx, ctx.email, `Réponse automatique modifiée : courrier entrant ${dest}.`)
    }
    return toSave
  })
}

export async function getForward(ctx: FiltersContext): Promise<ForwardSettings> {
  return withAvailableSession(ctx, async (session) => {
    const active = await loadActiveSet(ctx, session)
    return active?.forward ?? emptyForward()
  })
}

export async function putForward(
  ctx: FiltersContext,
  settings: ForwardSettings,
  confirm: SecurityConfirmation
): Promise<ForwardSettings> {
  return withAvailableSession(ctx, async (session, capabilities) => {
    const cfg = sieveRuntimeConfig(ctx.event)
    if (settings.enabled && !isAllowedForwardTarget(settings.address, cfg.forwardDomains)) {
      throw createError({ statusCode: 400, statusMessage: 'Domaine interdit', message: 'Transfert interdit vers ce domaine.' })
    }

    const active = await loadActiveSet(ctx, session)
    if (active && !active.managed) throw UNMANAGED_SET
    const name = active?.name ?? 'colombe'

    if (settings.enabled) await assertConfirmed(ctx, confirm)

    const script = generateScript(
      { rules: active?.rules ?? [], vacation: active?.vacation ?? null, forward: settings, capabilities },
      cfg.forwardDomains
    )
    await checkThenPut(ctx, session, name, script)
    await session.setActive(name)
    sievePool.invalidateAllScripts(ctx.sid)

    if (settings.enabled) {
      const copyNote = settings.keepCopy ? ' (copie conservée)' : ''
      await onForwardingChanged(ctx, ctx.email, `Transfert activé vers ${settings.address}${copyNote}.`)
    }
    return settings
  })
}

// ─── Alerte de sécurité ───

/**
 * Hook appelé après toute création/modification d'une redirection, d'une
 * notification, d'un transfert ou d'une réponse automatique redirigeant le
 * courrier entrant. Envoie l'alerte e-mail ; l'inscription dans « Activité
 * récente » (R2.6) sera câblée séparément par l'orchestrateur.
 */
export async function onForwardingChanged(ctx: FiltersContext, owner: string, summary: string): Promise<void> {
  try {
    const creds = await freshCredentials(ctx.sid)
    if (!creds) return
    const { kind, server } = mailConfig(ctx.event)
    const backend = createBackend(kind, creds, server)
    try {
      const raw = await buildRawMessage(owner, {
        to: [owner],
        cc: [],
        bcc: [],
        subject: 'Colombe : transfert modifié sur votre compte',
        text: summary,
        html: null,
        inReplyTo: null,
        references: [],
        attachments: [],
        draftUid: null,
      })
      await backend.send(raw, { from: owner, to: [owner] })
    } finally {
      await backend.close().catch(() => { /* ignore */ })
    }
  } catch (err) {
    console.error('[webmail] échec de l\'alerte de transfert', err instanceof Error ? err.name : typeof err)
  }
}

// ─── Erreurs -> HTTP ───

export function sieveError(err: unknown): H3Error {
  if (isError(err)) return err
  if (err instanceof SieveGenerateError) {
    return createError({ statusCode: 400, statusMessage: 'Fonctionnalité refusée', message: err.message })
  }
  if (err instanceof SieveError) {
    const map: Record<SieveErrorCode, [number, string]> = {
      AUTH_FAILED: [401, 'Authentification refusée par le serveur de filtres.'],
      NOT_FOUND: [404, err.message || 'Élément introuvable.'],
      INVALID: [400, err.serverMessage ?? err.message ?? 'Script invalide.'],
      UNAVAILABLE: [503, 'Serveur de filtres indisponible.'],
      CONNECT_FAILED: [503, 'Les filtres ne sont pas disponibles sur ce serveur.'],
    }
    const [statusCode, message] = map[err.code]
    return createError({ statusCode, statusMessage: message, message })
  }
  console.error('[webmail] erreur sieve inattendue', err instanceof Error ? err.name : typeof err)
  return createError({ statusCode: 500, statusMessage: 'Erreur serveur', message: 'Erreur serveur' })
}
