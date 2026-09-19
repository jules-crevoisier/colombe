/**
 * Configuration de Colombe, lue au DÉMARRAGE depuis les variables d'environnement
 * (et non figée au moment du build) : une même archive de release sert n'importe
 * quel établissement. Référence complète : docs/admin/CONFIGURATION.md.
 *
 * Aucune dépendance à Nuxt : testable seul et réutilisable par les scripts.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ClientSecurity, ClientServerSettings, PublicConfig } from '#shared/types/config'

export type Env = Record<string, string | undefined>

export interface TlsEndpoint {
  host: string
  port: number
  /** Nom attendu dans le certificat (SNI + vérification). */
  servername: string
}

export interface ColombeConfig {
  backend: 'imap' | 'mock'
  production: boolean
  imap: TlsEndpoint & {
    /** true : TLS implicite (993). false : STARTTLS (143). */
    secure: boolean
  }
  smtp: TlsEndpoint & {
    /** true : TLS implicite (465). false : STARTTLS (587). */
    secure: boolean
    /** Refuser l'envoi si STARTTLS n'est pas proposé (ignoré si `secure`). */
    requireTls: boolean
  }
  sieve: TlsEndpoint & { enabled: boolean }
  /** false uniquement en développement (certificat auto-signé) ; interdit en production. */
  tlsRejectUnauthorized: boolean
  login: {
    /** Domaines acceptés, en minuscules. Vide = tous (backend mock uniquement). */
    domains: string[]
    /** Domaine ajouté à un identifiant saisi sans @, ou null. */
    defaultDomain: string | null
    /** Identifiant présenté au serveur IMAP/SMTP/ManageSieve. */
    username: 'email' | 'localpart'
  }
  /** Domaines autorisés comme destination d'un transfert ou d'une redirection. */
  forwardDomains: string[]
  /** Derrière un proxy inverse : IP client = dernière valeur de X-Forwarded-For. */
  trustProxy: boolean
  /** Paramètres montrés aux utilisateurs pour configurer un autre logiciel. */
  clients: ClientServerSettings
  branding: {
    productName: string
    orgName: string
    loginMessage: string
    supportUrl: string | null
    supportEmail: string | null
    passwordResetUrl: string | null
    /** Chemin absolu d'un logo SVG/PNG/JPEG/WebP, ou null. */
    logoFile: string | null
  }
  dataDir: string
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuration invalide :\n${problems.map(p => `  - ${p}`).join('\n')}\nVoir docs/admin/CONFIGURATION.md.`)
    this.name = 'ConfigError'
  }
}

/** Domaine des comptes de démonstration du backend mémoire (server/lib/mail/mock.ts). */
const MOCK_DOMAIN = 'mmi-troyes.fr'
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const HOST_RE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LOGO_RE = /\.(svg|png|jpe?g|webp)$/i

/** Première variable définie et non vide parmi `names` (les alias historiques NUXT_MAIL_* restent acceptés). */
function pick(env: Env, ...names: string[]): string | undefined {
  for (const name of names) {
    const v = env[name]?.trim()
    if (v) return v
  }
  return undefined
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
}

function isLoopback(host: string): boolean {
  return /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(host)
}

/** Charge et valide la configuration. Lève ConfigError avec TOUS les problèmes trouvés. */
export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): ColombeConfig {
  const problems: string[] = []
  const production = env.NODE_ENV === 'production'

  const bool = (names: string[], fallback: boolean): boolean => {
    const raw = pick(env, ...names)
    if (raw === undefined) return fallback
    if (/^(1|true|yes|on|oui)$/i.test(raw)) return true
    if (/^(0|false|no|off|non)$/i.test(raw)) return false
    problems.push(`${names[0]} doit valoir true ou false (reçu « ${raw} »).`)
    return fallback
  }
  const port = (names: string[], fallback: number): number => {
    const raw = pick(env, ...names)
    if (raw === undefined) return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      problems.push(`${names[0]} doit être un numéro de port (1-65535), reçu « ${raw} ».`)
      return fallback
    }
    return n
  }
  const host = (name: string, value: string): string => {
    if (!HOST_RE.test(value)) problems.push(`${name} n'est pas un nom d'hôte valide (« ${value} »).`)
    return value
  }
  const url = (name: string): string | null => {
    const raw = pick(env, name)
    if (!raw) return null
    try {
      const u = new URL(raw)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString()
    }
    catch {
      // signalé ci-dessous
    }
    problems.push(`${name} doit être une URL http(s) complète (reçu « ${raw} »).`)
    return null
  }

  // --- Backend ---
  const backendRaw = (pick(env, 'MAIL_BACKEND', 'NUXT_MAIL_BACKEND') ?? 'imap').toLowerCase()
  if (backendRaw !== 'imap' && backendRaw !== 'mock') problems.push(`MAIL_BACKEND doit valoir imap ou mock (reçu « ${backendRaw} »).`)
  const backend: 'imap' | 'mock' = backendRaw === 'mock' ? 'mock' : 'imap'
  const mock = backend === 'mock'

  // --- Serveurs ---
  const mainHost = pick(env, 'MAIL_HOST', 'NUXT_MAIL_HOST')
  const imapHost = pick(env, 'MAIL_IMAP_HOST') ?? mainHost ?? (mock ? 'localhost' : '')
  const smtpHost = pick(env, 'MAIL_SMTP_HOST') ?? mainHost ?? (mock ? 'localhost' : '')
  if (!mock && !imapHost) problems.push('MAIL_HOST (ou MAIL_IMAP_HOST) est obligatoire : le serveur IMAP de l\'établissement.')
  if (!mock && !smtpHost) problems.push('MAIL_HOST (ou MAIL_SMTP_HOST) est obligatoire : le serveur SMTP de l\'établissement.')
  if (imapHost) host('MAIL_IMAP_HOST', imapHost)
  if (smtpHost) host('MAIL_SMTP_HOST', smtpHost)

  const tlsServername = pick(env, 'MAIL_TLS_SERVERNAME')
  const imapPort = port(['MAIL_IMAP_PORT', 'NUXT_MAIL_IMAP_PORT'], 993)
  const imapSecure = bool(['MAIL_IMAP_SECURE', 'NUXT_MAIL_IMAP_SECURE'], imapPort !== 143)
  const smtpPort = port(['MAIL_SMTP_PORT', 'NUXT_MAIL_SMTP_PORT'], 587)
  const smtpSecure = bool(['MAIL_SMTP_SECURE'], smtpPort === 465)
  const smtpRequireTls = bool(['MAIL_SMTP_REQUIRE_TLS', 'NUXT_MAIL_SMTP_REQUIRE_TLS'], true)
  const tlsRejectUnauthorized = bool(['MAIL_TLS_REJECT_UNAUTHORIZED', 'NUXT_MAIL_TLS_REJECT_UNAUTHORIZED'], true)
  if (production && !tlsRejectUnauthorized && env.WEBMAIL_ALLOW_INSECURE_TLS !== '1') {
    problems.push('MAIL_TLS_REJECT_UNAUTHORIZED=false est interdit en production (certificat non vérifié).')
  }

  const sieveHost = pick(env, 'MAIL_SIEVE_HOST', 'NUXT_MAIL_SIEVE_HOST') ?? imapHost
  if (sieveHost && pick(env, 'MAIL_SIEVE_HOST', 'NUXT_MAIL_SIEVE_HOST')) host('MAIL_SIEVE_HOST', sieveHost)

  // --- Connexion ---
  const domains = list(pick(env, 'MAIL_DOMAINS', 'MAIL_ALLOWED_DOMAIN', 'NUXT_MAIL_ALLOWED_DOMAIN') ?? (mock ? MOCK_DOMAIN : ''))
  for (const d of domains) if (!DOMAIN_RE.test(d)) problems.push(`MAIL_DOMAINS : « ${d} » n'est pas un nom de domaine.`)
  if (!mock && domains.length === 0) problems.push('MAIL_DOMAINS est obligatoire : le ou les domaines des adresses de l\'établissement (ex. univ-exemple.fr).')

  const defaultDomainRaw = pick(env, 'MAIL_LOGIN_DEFAULT_DOMAIN')?.toLowerCase()
  let defaultDomain: string | null = domains.length === 1 ? domains[0]! : null
  if (defaultDomainRaw !== undefined) {
    if (/^(none|aucun|false)$/.test(defaultDomainRaw)) defaultDomain = null
    else if (!domains.includes(defaultDomainRaw)) problems.push(`MAIL_LOGIN_DEFAULT_DOMAIN (« ${defaultDomainRaw} ») doit faire partie de MAIL_DOMAINS.`)
    else defaultDomain = defaultDomainRaw
  }
  const usernameRaw = (pick(env, 'MAIL_LOGIN_USERNAME') ?? 'email').toLowerCase()
  if (usernameRaw !== 'email' && usernameRaw !== 'localpart') problems.push(`MAIL_LOGIN_USERNAME doit valoir email ou localpart (reçu « ${usernameRaw} »).`)
  const username: 'email' | 'localpart' = usernameRaw === 'localpart' ? 'localpart' : 'email'

  const forwardDomains = list(pick(env, 'MAIL_FORWARD_DOMAINS', 'NUXT_MAIL_FORWARD_DOMAINS'))
  for (const d of forwardDomains) if (!DOMAIN_RE.test(d)) problems.push(`MAIL_FORWARD_DOMAINS : « ${d} » n'est pas un nom de domaine.`)

  // --- Paramètres publics (autres logiciels) ---
  const publicHost = pick(env, 'MAIL_PUBLIC_HOST')
  const publicImapHost = pick(env, 'MAIL_PUBLIC_IMAP_HOST') ?? publicHost ?? (imapHost && !isLoopback(imapHost) ? imapHost : '')
  const publicSmtpHost = pick(env, 'MAIL_PUBLIC_SMTP_HOST') ?? publicHost ?? (smtpHost && !isLoopback(smtpHost) ? smtpHost : '')
  if (publicImapHost) host('MAIL_PUBLIC_IMAP_HOST', publicImapHost)
  if (publicSmtpHost) host('MAIL_PUBLIC_SMTP_HOST', publicSmtpHost)
  const publicImapPort = port(['MAIL_PUBLIC_IMAP_PORT'], imapPort)
  const publicSmtpPort = port(['MAIL_PUBLIC_SMTP_PORT'], smtpPort)
  const security = (p: number, implicitPort: number, secure: boolean, samePort: boolean): ClientSecurity =>
    (samePort ? secure : p === implicitPort) ? 'ssl' : 'starttls'

  // --- Identité visuelle ---
  const supportEmail = pick(env, 'COLOMBE_SUPPORT_EMAIL') ?? null
  if (supportEmail && !EMAIL_RE.test(supportEmail)) problems.push(`COLOMBE_SUPPORT_EMAIL n'est pas une adresse e-mail (« ${supportEmail} »).`)
  const logoRaw = pick(env, 'COLOMBE_LOGO_FILE')
  let logoFile: string | null = null
  if (logoRaw) {
    const abs = isAbsolute(logoRaw) ? logoRaw : resolve(cwd, logoRaw)
    if (!LOGO_RE.test(abs)) problems.push('COLOMBE_LOGO_FILE doit être un fichier .svg, .png, .jpg ou .webp.')
    else if (!existsSync(abs)) problems.push(`COLOMBE_LOGO_FILE : fichier introuvable (${abs}).`)
    else logoFile = abs
  }

  // --- Secrets (production) ---
  if (production) {
    if (mock && env.WEBMAIL_ALLOW_MOCK !== '1') problems.push('MAIL_BACKEND=mock est interdit en production (comptes de démonstration).')
    if ((env.NUXT_SESSION_PASSWORD ?? '').length < 32) problems.push('NUXT_SESSION_PASSWORD doit contenir au moins 32 caractères (openssl rand -base64 32).')
    if ((env.WEBMAIL_DATA_KEY ?? '').length < 32) problems.push('WEBMAIL_DATA_KEY doit contenir au moins 32 caractères (openssl rand -base64 32), différente de NUXT_SESSION_PASSWORD.')
    else if (env.WEBMAIL_DATA_KEY === env.NUXT_SESSION_PASSWORD) problems.push('WEBMAIL_DATA_KEY doit être différente de NUXT_SESSION_PASSWORD.')
  }

  const sieveEnabled = bool(['MAIL_SIEVE_ENABLED'], true)
  const sievePort = port(['MAIL_SIEVE_PORT', 'NUXT_MAIL_SIEVE_PORT'], 4190)
  const trustProxy = bool(['MAIL_TRUST_PROXY', 'NUXT_MAIL_TRUST_PROXY'], false)
  const supportUrl = url('COLOMBE_SUPPORT_URL')
  const passwordResetUrl = url('COLOMBE_PASSWORD_RESET_URL')

  if (problems.length) throw new ConfigError(problems)

  return {
    backend,
    production,
    imap: { host: imapHost, port: imapPort, secure: imapSecure, servername: tlsServername ?? imapHost },
    smtp: { host: smtpHost, port: smtpPort, secure: smtpSecure, requireTls: smtpRequireTls, servername: tlsServername ?? smtpHost },
    sieve: {
      enabled: sieveEnabled,
      host: sieveHost,
      port: sievePort,
      // ManageSieve souvent en local (127.0.0.1) : le certificat est celui du serveur de messagerie.
      servername: pick(env, 'MAIL_SIEVE_TLS_SERVERNAME', 'NUXT_MAIL_SIEVE_TLS_SERVERNAME') ?? tlsServername ?? imapHost,
    },
    tlsRejectUnauthorized,
    login: { domains, defaultDomain, username },
    forwardDomains: forwardDomains.length ? forwardDomains : domains,
    trustProxy,
    clients: {
      imap: publicImapHost ? { host: publicImapHost, port: publicImapPort, security: security(publicImapPort, 993, imapSecure, publicImapPort === imapPort) } : null,
      smtp: publicSmtpHost ? { host: publicSmtpHost, port: publicSmtpPort, security: security(publicSmtpPort, 465, smtpSecure, publicSmtpPort === smtpPort) } : null,
      username,
    },
    branding: {
      productName: pick(env, 'COLOMBE_NAME') ?? 'Colombe',
      orgName: pick(env, 'COLOMBE_ORG_NAME') ?? '',
      loginMessage: pick(env, 'COLOMBE_LOGIN_MESSAGE') ?? '',
      supportUrl,
      supportEmail,
      passwordResetUrl,
      logoFile,
    },
    dataDir: resolve(cwd, pick(env, 'WEBMAIL_DATA_DIR') ?? '.data'),
  }
}

let cached: ColombeConfig | null = null

/** Configuration du processus (chargée une fois). Lève ConfigError si invalide. */
export function getConfig(): ColombeConfig {
  cached ??= loadConfig()
  return cached
}

/** Tests uniquement. */
export function setConfigForTests(config: ColombeConfig | null): void {
  cached = config
}

/**
 * Normalise l'identifiant saisi à la connexion : minuscules, domaine par défaut
 * ajouté s'il manque. Renvoie null si le domaine n'est pas accepté.
 */
export function normalizeLoginEmail(input: string, config: Pick<ColombeConfig, 'login'>): string | null {
  let value = input.trim().toLowerCase()
  if (!value) return null
  if (!value.includes('@')) {
    if (!config.login.defaultDomain) return null
    value = `${value}@${config.login.defaultDomain}`
  }
  if (!EMAIL_RE.test(value) || /[\s<>()"]/.test(value)) return null
  const domain = value.slice(value.lastIndexOf('@') + 1)
  if (config.login.domains.length && !config.login.domains.includes(domain)) return null
  return value
}

/** Identifiant présenté au serveur de messagerie pour une adresse. */
export function authUsername(email: string, config: Pick<ColombeConfig, 'login'>): string {
  return config.login.username === 'localpart' ? email.slice(0, email.lastIndexOf('@')) : email
}

/** Partie publique, pour GET /api/config. */
export function publicConfig(config: ColombeConfig): PublicConfig {
  const b = config.branding
  return {
    productName: b.productName,
    orgName: b.orgName,
    loginMessage: b.loginMessage,
    supportUrl: b.supportUrl,
    supportEmail: b.supportEmail,
    passwordResetUrl: b.passwordResetUrl,
    hasLogo: b.logoFile !== null,
    login: { domains: config.login.domains, defaultDomain: config.login.defaultDomain },
  }
}
