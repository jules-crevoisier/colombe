/**
 * Configuration de Colombe, lue au DÉMARRAGE depuis les variables d'environnement
 * (et non figée au moment du build) : une même archive de release sert n'importe
 * quel établissement. Référence complète : docs/admin/configuration.md.
 *
 * Aucune dépendance à Nuxt : testable seul et réutilisable par les scripts.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ClientSecurity, ClientServerSettings, LoginMethod, PublicConfig } from '#shared/types/config'

export type Env = Record<string, string | undefined>

// ─── SSO (OIDC) : début ───
/** Connexion unique OpenID Connect (AUTH_METHODS contient « oidc »). */
export interface OidcConfig {
  /** URL de l'émetteur (découverte : <issuer>/.well-known/openid-configuration). */
  issuer: string
  clientId: string
  clientSecret: string
  /** Portées demandées, séparées par des espaces. */
  scopes: string
  /** Revendication (claim) qui porte l'adresse de messagerie. */
  emailClaim: string
  buttonLabel: string
  /** Déconnexion initiée par Colombe chez le fournisseur d'identité (end_session_endpoint). */
  logout: boolean
  /** URL de retour imposée, ou null (déduite de la requête). */
  redirectUrl: string | null
}

/** Mécanisme SASL qui présente le jeton d'accès OIDC à Dovecot/Postfix. */
export type MailOAuthMechanism = 'xoauth2' | 'oauthbearer'

/**
 * Accès à la messagerie après une connexion unique (Colombe n'a pas le mot de passe) :
 *   - oauth2 : le jeton d'accès OIDC est présenté au serveur (Dovecot `oauth2 { }`) ;
 *   - master : utilisateur maître Dovecot (accès à toutes les boîtes, déconseillé).
 */
export type MailSsoConfig =
  | { mode: 'oauth2'; mechanism: MailOAuthMechanism }
  | { mode: 'master'; masterUser: string; masterPassword: string; separator: string }
// ─── SSO (OIDC) : fin ───

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
  /** Limites (fenêtre de 15 minutes pour les compteurs). */
  limits: {
    sendPer15Min: number
    loginPerAccount: number
    loginPerIp: number
    /** Total des pièces jointes d'un message, en octets (vérifié dans le navigateur). */
    attachmentsBytes: number
  }
  dataDir: string
  /** Démo publique (COLOMBE_DEMO) : comptes visiteurs jetables, base en mémoire. */
  demo: {
    enabled: boolean
    /** Durée de vie d'un compte visiteur, en heures (1..72). */
    ttlHours: number
    /** Nombre maximum de comptes visiteurs simultanés (1..5000). */
    maxAccounts: number
    /** Lien « Découvrir le projet » affiché dans la démo, ou null. */
    projectUrl: string | null
  }
  // ─── LDAP (annuaire de l'établissement) ───
  /** null : fonctionnalité désactivée (LDAP_URL absent). */
  ldap: LdapConfig | null
  // ─── fin LDAP ───
  // ─── SSO (OIDC) : début ───
  /** Méthodes de connexion (AUTH_METHODS), au moins une. */
  authMethods: LoginMethod[]
  /** null si « oidc » n'est pas dans AUTH_METHODS. */
  oidc: OidcConfig | null
  /** Accès IMAP/SMTP/ManageSieve des sessions OIDC ; null si OIDC désactivé. */
  mailSso: MailSsoConfig | null
  /** Lien « Retour à l'ENT » (COLOMBE_PORTAL_URL), ou null. */
  portalUrl: string | null
  // ─── SSO (OIDC) : fin ───
}

/** Recherche dans l'annuaire LDAP de l'établissement (schéma SupAnn / inetOrgPerson). */
export interface LdapConfig {
  /** URL complète, ex. ldaps://annuaire.univ-exemple.fr:636. */
  url: string
  /** StartTLS sur une URL ldap:// (RFC 4513). Ignoré (non nécessaire) avec ldaps://. */
  startTls: boolean
  /** DN de liaison, ou null pour une liaison anonyme (LDAP_BIND_DN/LDAP_BIND_PASSWORD). */
  bindDn: string | null
  bindPassword: string | null
  baseDn: string
  /** Filtre de base combiné en AND avec les termes de recherche (LDAP_FILTER). */
  filter: string
  /** Attributs comparés à chaque mot de la requête (LDAP_SEARCH_ATTRS). */
  searchAttrs: string[]
  /** Attributs LDAP → champs de DirectoryEntry (défauts adaptés à SupAnn). */
  attrs: {
    name: string
    /** Repli si `attrs.name` (LDAP_ATTR_NAME, défaut displayName) est absent : cn. */
    nameFallback: string
    email: string
    phone: string
    title: string
    department: string
    affiliation: string
  }
  /** Résultats renvoyés au maximum (LDAP_MAX_RESULTS, 1..100). */
  maxResults: number
  /** Longueur minimale de la requête (LDAP_MIN_QUERY). */
  minQuery: number
  timeoutMs: number
  /** Valeurs d'affiliation exclues des résultats (LDAP_HIDE_AFFILIATIONS), en minuscules. */
  hideAffiliations: string[]
}

export class ConfigError extends Error {
  // Pas de « propriété de paramètre » TypeScript : ce fichier doit rester exécutable
  // tel quel par Node (type stripping) pour les scripts d'administration.
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Configuration invalide :\n${problems.map(p => `  - ${p}`).join('\n')}\nVoir docs/admin/configuration.md.`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

/** Domaine des comptes de démonstration du backend mémoire (server/lib/mail/mock.ts). */
const MOCK_DOMAIN = 'universite.example'
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

/** Comme `list()` mais sans mise en minuscules : noms d'attributs LDAP (ex. displayName). */
function attrList(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
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

  // --- Démo publique ---
  const demoEnabled = bool(['COLOMBE_DEMO'], false)
  if (demoEnabled && !mock) problems.push('COLOMBE_DEMO=true nécessite MAIL_BACKEND=mock (aucun serveur IMAP réel en démo).')

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
    // Démo publique : le backend mémoire est le but recherché, pas une faille de configuration.
    if (mock && !demoEnabled && env.WEBMAIL_ALLOW_MOCK !== '1') problems.push('MAIL_BACKEND=mock est interdit en production (comptes de démonstration).')
    if ((env.NUXT_SESSION_PASSWORD ?? '').length < 32) problems.push('NUXT_SESSION_PASSWORD doit contenir au moins 32 caractères (openssl rand -base64 32).')
    if ((env.WEBMAIL_DATA_KEY ?? '').length < 32) problems.push('WEBMAIL_DATA_KEY doit contenir au moins 32 caractères (openssl rand -base64 32), différente de NUXT_SESSION_PASSWORD.')
    else if (env.WEBMAIL_DATA_KEY === env.NUXT_SESSION_PASSWORD) problems.push('WEBMAIL_DATA_KEY doit être différente de NUXT_SESSION_PASSWORD.')
  }

  const sieveEnabled = bool(['MAIL_SIEVE_ENABLED'], true)
  const sievePort = port(['MAIL_SIEVE_PORT', 'NUXT_MAIL_SIEVE_PORT'], 4190)
  const trustProxy = bool(['MAIL_TRUST_PROXY', 'NUXT_MAIL_TRUST_PROXY'], false)
  const count = (name: string, fallback: number, max: number): number => {
    const raw = pick(env, name)
    if (raw === undefined) return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > max) {
      problems.push(`${name} doit être un entier entre 1 et ${max} (reçu « ${raw} »).`)
      return fallback
    }
    return n
  }
  const limits = {
    sendPer15Min: count('COLOMBE_SEND_LIMIT', 20, 10_000),
    loginPerAccount: count('COLOMBE_LOGIN_LIMIT_ACCOUNT', 5, 1000),
    loginPerIp: count('COLOMBE_LOGIN_LIMIT_IP', 30, 100_000),
    attachmentsBytes: count('COLOMBE_MAX_ATTACHMENTS_MB', 10, 100) * 1024 * 1024,
  }
  const baseUrl = env.NUXT_APP_BASE_URL?.trim()
  if (baseUrl && !/^\/(?:[\w.~-]+\/)*$/.test(baseUrl)) {
    problems.push(`NUXT_APP_BASE_URL doit commencer et finir par « / », sans espace (ex. /colombe/), reçu « ${baseUrl} ».`)
  }
  const supportUrl = url('COLOMBE_SUPPORT_URL')
  const passwordResetUrl = url('COLOMBE_PASSWORD_RESET_URL')

  const demoTtlHours = count('COLOMBE_DEMO_TTL_HOURS', 4, 72)
  const demoMaxAccounts = count('COLOMBE_DEMO_MAX_ACCOUNTS', 200, 5000)
  const demoProjectUrl = url('COLOMBE_PROJECT_URL')

  // ─── LDAP (annuaire de l'établissement) ───
  const ldapUrlRaw = pick(env, 'LDAP_URL')
  let ldap: LdapConfig | null = null
  if (ldapUrlRaw) {
    const ldapStartTls = bool(['LDAP_STARTTLS'], false)

    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(ldapUrlRaw)
    }
    catch {
      problems.push(`LDAP_URL n'est pas une URL valide (reçu « ${ldapUrlRaw} »).`)
    }
    if (parsedUrl && parsedUrl.protocol !== 'ldap:' && parsedUrl.protocol !== 'ldaps:') {
      problems.push(`LDAP_URL doit commencer par ldap:// ou ldaps:// (reçu « ${ldapUrlRaw} »).`)
      parsedUrl = null
    }
    if (parsedUrl && parsedUrl.protocol === 'ldap:' && !ldapStartTls && !isLoopback(parsedUrl.hostname)) {
      problems.push('LDAP_URL en ldap:// vers un hôte distant nécessite LDAP_STARTTLS=true (sinon le mot de passe de liaison circule en clair) — utilisez ldaps:// ou LDAP_STARTTLS=true, ou un hôte local (127.0.0.1/localhost) pour le développement.')
    }

    const ldapBindDn = pick(env, 'LDAP_BIND_DN') ?? null
    const ldapBindPassword = pick(env, 'LDAP_BIND_PASSWORD') ?? null
    if ((ldapBindDn === null) !== (ldapBindPassword === null)) {
      problems.push('LDAP_BIND_DN et LDAP_BIND_PASSWORD doivent être fournis ensemble, ou aucun des deux pour une liaison anonyme.')
    }

    const ldapBaseDn = pick(env, 'LDAP_BASE_DN')
    if (!ldapBaseDn) problems.push('LDAP_BASE_DN est obligatoire quand LDAP_URL est défini.')

    const ldapFilter = pick(env, 'LDAP_FILTER') ?? '(&(objectClass=inetOrgPerson)(mail=*))'
    if (!/^\(.*\)$/.test(ldapFilter)) problems.push(`LDAP_FILTER doit être un filtre LDAP entre parenthèses (reçu « ${ldapFilter} »).`)

    const ldapSearchAttrs = attrList(pick(env, 'LDAP_SEARCH_ATTRS') ?? 'cn,displayName,mail,sn,givenName,uid')
    if (!ldapSearchAttrs.length) problems.push('LDAP_SEARCH_ATTRS ne peut pas être vide.')

    const ldapMaxResults = count('LDAP_MAX_RESULTS', 20, 100)
    const ldapMinQuery = count('LDAP_MIN_QUERY', 3, 50)
    const ldapTimeoutMs = count('LDAP_TIMEOUT_MS', 5000, 60_000)
    const ldapHideAffiliations = list(pick(env, 'LDAP_HIDE_AFFILIATIONS'))

    ldap = {
      url: ldapUrlRaw,
      startTls: ldapStartTls,
      bindDn: ldapBindDn,
      bindPassword: ldapBindPassword,
      baseDn: ldapBaseDn ?? '',
      filter: ldapFilter,
      searchAttrs: ldapSearchAttrs,
      attrs: {
        name: pick(env, 'LDAP_ATTR_NAME') ?? 'displayName',
        nameFallback: 'cn',
        email: pick(env, 'LDAP_ATTR_EMAIL') ?? 'mail',
        phone: pick(env, 'LDAP_ATTR_PHONE') ?? 'telephoneNumber',
        title: pick(env, 'LDAP_ATTR_TITLE') ?? 'title',
        department: pick(env, 'LDAP_ATTR_DEPARTMENT') ?? 'ou',
        affiliation: pick(env, 'LDAP_ATTR_AFFILIATION') ?? 'eduPersonPrimaryAffiliation',
      },
      maxResults: ldapMaxResults,
      minQuery: ldapMinQuery,
      timeoutMs: ldapTimeoutMs,
      hideAffiliations: ldapHideAffiliations,
    }
  }
  // ─── fin LDAP ───
  // ─── SSO (OIDC) : début ───
  const authMethods: LoginMethod[] = []
  for (const m of list(pick(env, 'AUTH_METHODS') ?? 'password')) {
    if (m !== 'password' && m !== 'oidc') problems.push(`AUTH_METHODS : « ${m} » n'est pas une méthode connue (password, oidc).`)
    else if (!authMethods.includes(m)) authMethods.push(m)
  }
  if (authMethods.length === 0 && !problems.some(p => p.startsWith('AUTH_METHODS'))) problems.push('AUTH_METHODS doit contenir au moins une méthode (password, oidc).')
  const oidcEnabled = authMethods.includes('oidc')

  let oidc: OidcConfig | null = null
  if (oidcEnabled) {
    if (demoEnabled) problems.push('AUTH_METHODS=oidc est incompatible avec COLOMBE_DEMO=true (la démo n\'a pas de fournisseur d\'identité).')
    const issuerRaw = pick(env, 'OIDC_ISSUER')
    let issuer = ''
    if (!issuerRaw) problems.push('OIDC_ISSUER est obligatoire avec AUTH_METHODS=oidc : l\'URL de l\'émetteur OpenID Connect (ex. https://idp.univ-exemple.fr/realms/univ).')
    else {
      try {
        const u = new URL(issuerRaw)
        // http toléré uniquement en boucle locale (fournisseur sur la même machine, tests).
        if (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback(u.hostname))) issuer = issuerRaw.replace(/\/+$/, '')
        else problems.push(`OIDC_ISSUER doit être une URL https (reçu « ${issuerRaw} »).`)
        if (u.search || u.hash) problems.push('OIDC_ISSUER ne doit contenir ni « ? » ni « # ».')
      }
      catch {
        problems.push(`OIDC_ISSUER doit être une URL https complète (reçu « ${issuerRaw} »).`)
      }
    }
    const clientId = pick(env, 'OIDC_CLIENT_ID') ?? ''
    if (!clientId) problems.push('OIDC_CLIENT_ID est obligatoire avec AUTH_METHODS=oidc (identifiant du client déclaré chez le fournisseur d\'identité).')
    const clientSecret = pick(env, 'OIDC_CLIENT_SECRET') ?? ''
    if (!clientSecret) problems.push('OIDC_CLIENT_SECRET est obligatoire avec AUTH_METHODS=oidc (secret du client confidentiel).')
    const scopes = (pick(env, 'OIDC_SCOPES') ?? 'openid email profile offline_access').split(/[\s,]+/).filter(Boolean)
    if (!scopes.includes('openid')) problems.push('OIDC_SCOPES doit contenir « openid ».')
    const emailClaim = pick(env, 'OIDC_EMAIL_CLAIM') ?? 'email'
    if (!/^[\w.:/-]{1,128}$/.test(emailClaim)) problems.push(`OIDC_EMAIL_CLAIM n'est pas un nom de revendication valide (« ${emailClaim} »).`)
    const redirectUrl = url('OIDC_REDIRECT_URL')
    if (redirectUrl && !/\/api\/auth\/oidc\/callback$/.test(new URL(redirectUrl).pathname)) {
      problems.push('OIDC_REDIRECT_URL doit se terminer par /api/auth/oidc/callback.')
    }
    oidc = {
      issuer,
      clientId,
      clientSecret,
      scopes: scopes.join(' '),
      emailClaim,
      buttonLabel: pick(env, 'OIDC_BUTTON_LABEL') ?? 'Se connecter avec mon compte de l\'établissement',
      logout: bool(['OIDC_LOGOUT'], true),
      redirectUrl,
    }
  }

  let mailSso: MailSsoConfig | null = null
  const ssoAuthRaw = pick(env, 'MAIL_SSO_AUTH')?.toLowerCase()
  if (ssoAuthRaw !== undefined && ssoAuthRaw !== 'oauth2' && ssoAuthRaw !== 'master') {
    problems.push(`MAIL_SSO_AUTH doit valoir oauth2 ou master (reçu « ${ssoAuthRaw} »).`)
  }
  if (ssoAuthRaw === 'master' && !oidcEnabled) problems.push('MAIL_SSO_AUTH=master n\'a de sens qu\'avec AUTH_METHODS=oidc : retirez MAIL_MASTER_PASSWORD de la configuration.')
  const mechanismRaw = (pick(env, 'MAIL_OAUTH_MECHANISM') ?? 'xoauth2').toLowerCase()
  if (mechanismRaw !== 'xoauth2' && mechanismRaw !== 'oauthbearer') problems.push(`MAIL_OAUTH_MECHANISM doit valoir xoauth2 ou oauthbearer (reçu « ${mechanismRaw} »).`)
  if (oidcEnabled) {
    if (ssoAuthRaw === 'master') {
      const masterUser = pick(env, 'MAIL_MASTER_USER') ?? ''
      const masterPassword = env.MAIL_MASTER_PASSWORD ?? ''
      const separator = pick(env, 'MAIL_MASTER_SEPARATOR') ?? '*'
      if (!masterUser) problems.push('MAIL_MASTER_USER est obligatoire avec MAIL_SSO_AUTH=master (utilisateur maître Dovecot).')
      else if (/[\s@]/.test(masterUser)) problems.push('MAIL_MASTER_USER ne doit contenir ni espace ni @.')
      if (masterPassword.length < 24) problems.push('MAIL_MASTER_PASSWORD doit contenir au moins 24 caractères (openssl rand -base64 32) : il ouvre TOUTES les boîtes.')
      if (!/^[^\s\w@.-]$/.test(separator)) problems.push(`MAIL_MASTER_SEPARATOR doit être un seul caractère spécial, comme dans auth_master_user_separator (reçu « ${separator} »).`)
      if (mock || demoEnabled) problems.push('MAIL_SSO_AUTH=master est interdit avec le backend mock ou la démo.')
      mailSso = { mode: 'master', masterUser, masterPassword, separator }
    }
    else {
      mailSso = { mode: 'oauth2', mechanism: mechanismRaw === 'oauthbearer' ? 'oauthbearer' : 'xoauth2' }
    }
  }
  const portalUrl = url('COLOMBE_PORTAL_URL')
  // ─── SSO (OIDC) : fin ───

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
    limits,
    dataDir: resolve(cwd, pick(env, 'WEBMAIL_DATA_DIR') ?? '.data'),
    demo: { enabled: demoEnabled, ttlHours: demoTtlHours, maxAccounts: demoMaxAccounts, projectUrl: demoProjectUrl },
    ldap,
    // ─── SSO (OIDC) : début ───
    authMethods,
    oidc,
    mailSso,
    portalUrl,
    // ─── SSO (OIDC) : fin ───
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
  if (!EMAIL_RE.test(value) || /[\s<>()"\\\x00-\x1f\x7f]/.test(value)) return null
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
    login: {
      domains: config.login.domains,
      defaultDomain: config.login.defaultDomain,
      // ─── SSO (OIDC) : début ───
      methods: [...config.authMethods],
      oidc: config.oidc ? { label: config.oidc.buttonLabel } : null,
      // ─── SSO (OIDC) : fin ───
    },
    limits: { attachmentsBytes: config.limits.attachmentsBytes },
    demo: config.demo.enabled ? { ttlHours: config.demo.ttlHours, projectUrl: config.demo.projectUrl } : null,
    // ─── LDAP (annuaire de l'établissement) ───
    features: { directory: config.ldap !== null },
    // ─── fin LDAP ───
    // ─── SSO (OIDC) : début ───
    portalUrl: config.portalUrl,
    // ─── SSO (OIDC) : fin ───
  }
}

// ─── SSO (OIDC) : début ───
/**
 * Identifiant IMAP d'un utilisateur maître Dovecot : `<utilisateur><séparateur><maître>`
 * (auth_master_user_separator, `*` par défaut) — ex. `jean.dupont@univ.fr*colombe`.
 */
export function masterLogin(user: string, masterUser: string, separator: string): string {
  return `${user}${separator}${masterUser}`
}
// ─── SSO (OIDC) : fin ───
