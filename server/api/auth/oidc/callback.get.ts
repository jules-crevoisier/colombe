import type { H3Event } from 'h3'
import { getConfig } from '../../../lib/config'
import type { MailAuth } from '../../../lib/mail/backend'
import { MailError } from '../../../lib/mail/backend'
import { verifyCredentials } from '../../../lib/mail/index'
import { createPending } from '../../../lib/auth/pending'
import { addressFromClaims } from '../../../lib/auth/oidc/claims'
import { exchangeCode, getOidcConfiguration } from '../../../lib/auth/oidc/client'
import type { CodeExchangeResult } from '../../../lib/auth/oidc/client'
import { takeFlow } from '../../../lib/auth/oidc/flow'
import { credentialsStore } from '../../../lib/session/credentials'
import { ipLoginLimiter, loginLimiter } from '../../../lib/session/rate-limit'
import { recordLoginEvent } from '../../../lib/store/activity'
import { useDb } from '../../../lib/store/db'
import { isTwoFactorEnabled } from '../../../lib/store/twofactor'
import { clientIp, logSafe, mailConfig } from '../../../utils/mail-session'
import { appBase, flowCookieOptions, isNetworkError, type OidcLoginError } from '../../../utils/oidc-route'

/** Tolérance d'horloge entre Colombe et le fournisseur pour `auth_time`. */
const CLOCK_SKEW_MS = 60_000

/** Chemin d'application → URL relative au déploiement (« /mail/INBOX » → « /colombe/mail/INBOX »). */
function appPath(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/, '')}`
}

/** Une ligne par échec, même format que la connexion par mot de passe (fail2ban). */
function logFailure(ip: string, user: string): void {
  console.warn(`[colombe] auth-failure ip=${logSafe(ip)} user=${logSafe(user) || '-'}`)
}

/**
 * Diagnostic pour l'administrateur (journal serveur uniquement) : code d'erreur OAuth du
 * fournisseur (invalid_grant, invalid_client…) ou code de validation d'openid-client.
 */
function describeOidcError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err
  const e = err as Error & { code?: unknown; error?: unknown; error_description?: unknown }
  const parts = [`${e.name}: ${e.message}`]
  if (typeof e.code === 'string') parts.push(`code=${e.code}`)
  if (typeof e.error === 'string') parts.push(`error=${e.error}`)
  if (typeof e.error_description === 'string') parts.push(`description=« ${e.error_description.replace(/[\r\n]+/g, ' ').slice(0, 200)} »`)
  return parts.join(' ')
}

/** Réauthentification : retour sur la page d'origine avec ?reauth=ok|failed. */
function withReauthResult(base: string, returnTo: string | null, ok: boolean): string {
  const url = new URL(returnTo ?? '/settings', 'http://colombe.invalid')
  url.searchParams.set('reauth', ok ? 'ok' : 'failed')
  return appPath(base, `${url.pathname}${url.search}${url.hash}`)
}

/**
 * GET /api/auth/oidc/callback — retour du fournisseur d'identité. Vérifie state, nonce,
 * PKCE et le jeton d'identité (openid-client), associe l'adresse (OIDC_EMAIL_CLAIM,
 * MAIL_DOMAINS), vérifie l'accès à la boîte (jeton ou utilisateur maître), applique la
 * double authentification Colombe si activée, puis ouvre la session. Toute erreur :
 * 302 vers /login?error=<code>.
 */
export default defineEventHandler(async (event: H3Event) => {
  const config = getConfig()
  if (!config.oidc || !config.mailSso) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const oidcConfig = config.oidc
  const mailSso = config.mailSso

  const base = appBase(event)
  const fail = (code: OidcLoginError) => sendRedirect(event, `${base}login?error=${code}`, 302)
  const ip = clientIp(event)
  const userAgent = getRequestHeader(event, 'user-agent') ?? ''
  const ipKey = `ip:${ip}`

  // Usage unique : l'état est effacé ici, que la suite réussisse ou non.
  const flow = await takeFlow(event, flowCookieOptions(event))
  const query = getQuery(event)
  if (!flow) return fail('expired')
  if (typeof query.error === 'string') {
    // access_denied : l'utilisateur a annulé ; le reste (login_required…) vient du fournisseur.
    return fail(query.error === 'access_denied' ? 'cancelled' : 'idp')
  }
  if (ipLoginLimiter.isLimited(ipKey)) return fail('rate')

  let result: CodeExchangeResult
  try {
    const cfg = await getOidcConfiguration(oidcConfig)
    // Paramètres réellement reçus, sur l'URL de retour exacte de la demande.
    const callbackUrl = new URL(flow.redirectUri)
    callbackUrl.search = new URL(event.path, 'http://colombe.invalid').search
    result = await exchangeCode(cfg, callbackUrl, flow, oidcConfig.emailClaim)
  }
  catch (err) {
    if (isNetworkError(err)) {
      console.error('[colombe] OIDC : fournisseur injoignable', err instanceof Error ? err.message : typeof err)
      return fail('unavailable')
    }
    // state/nonce/PKCE/signature invalides : traité comme un échec d'authentification.
    console.warn('[colombe] OIDC : réponse refusée', describeOidcError(err))
    ipLoginLimiter.hit(ipKey)
    logFailure(ip, '')
    return fail('invalid')
  }

  const mapped = addressFromClaims(result.claims, oidcConfig.emailClaim, config)
  if (!mapped.ok) {
    console.warn(`[colombe] OIDC : adresse refusée (${mapped.reason}, revendication ${oidcConfig.emailClaim})`)
    logFailure(ip, mapped.value)
    if (flow.reauth) return sendRedirect(event, withReauthResult(base, flow.returnTo, false), 302)
    return fail(mapped.reason === 'domain' ? 'domain' : 'claim')
  }
  const email = mapped.email

  // ─── Réauthentification d'une session ouverte (confirmation d'une action sensible) ───
  if (flow.reauth) {
    const session = await getUserSession(event)
    const sid = session.secure?.sid
    const authTime = typeof result.claims.auth_time === 'number' ? result.claims.auth_time * 1000 : 0
    const sameUser = session.authMethod === 'oidc' && session.user?.email === email && !!sid
    // max_age=0 a été demandé : l'identification doit dater de cette demande-ci.
    const recent = authTime >= flow.startedAt - CLOCK_SKEW_MS
    if (!sameUser || !recent || !sid || !credentialsStore.markReauth(sid)) {
      logFailure(ip, email)
      return sendRedirect(event, withReauthResult(base, flow.returnTo, false), 302)
    }
    credentialsStore.updateOAuth(sid, { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: result.expiresAt, idToken: result.idToken })
    return sendRedirect(event, withReauthResult(base, flow.returnTo, true), 302)
  }

  // ─── Connexion ───
  const auth: MailAuth = mailSso.mode === 'oauth2'
    ? { kind: 'oauth2', accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: result.expiresAt }
    : { kind: 'master' }
  const { kind, server } = mailConfig(event)
  let valid: boolean
  try {
    valid = await verifyCredentials(kind, { email, auth }, server)
  }
  catch (err) {
    const unavailable = err instanceof MailError && err.code === 'UNAVAILABLE'
    console.error('[colombe] OIDC : vérification de la boîte impossible', unavailable ? 'serveur injoignable' : (err instanceof Error ? err.name : typeof err))
    return fail('unavailable')
  }
  if (!valid) {
    // Jeton refusé par Dovecot (configuration oauth2) ou boîte inexistante.
    ipLoginLimiter.hit(ipKey)
    recordLoginEvent(useDb(), email, ip, userAgent, false)
    logFailure(ip, email)
    return fail('mailbox')
  }

  const sso = { idToken: result.idToken }
  if (isTwoFactorEnabled(useDb(), email)) {
    const pendingId = createPending(email, auth, Date.now(), sso)
    await replaceUserSession(event, { secure: { pendingId } })
    return sendRedirect(event, `${base}login?step=2fa`, 302)
  }

  loginLimiter.reset(`email:${email}`)
  recordLoginEvent(useDb(), email, ip, userAgent, true)
  const sid = credentialsStore.create(email, auth, ip, userAgent, sso)
  // replaceUserSession régénère le cookie : protection contre la fixation de session.
  await replaceUserSession(event, { user: { email }, secure: { sid }, loggedInAt: Date.now(), authMethod: 'oidc' })
  return sendRedirect(event, appPath(base, flow.returnTo ?? '/mail/INBOX'), 302)
})
