/**
 * Client OpenID Connect (openid-client, panva) : découverte, code d'autorisation + PKCE,
 * state/nonce, rafraîchissement, déconnexion RP-initiated. Toute la validation
 * cryptographique (signature du jeton d'identité, iss/aud/exp/nonce) est faite par la
 * bibliothèque — jamais ici.
 */
import * as oidc from 'openid-client'
import type { OidcConfig } from '../../config'
import { expiresAtFrom, type RefreshedTokens } from './refresh'

const HTTP_TIMEOUT_S = 10
/** La découverte est rejouée au plus toutes les heures (rotation de clés gérée par openid-client). */
const DISCOVERY_TTL_MS = 60 * 60_000

let cached: { key: string; at: number; config: Promise<oidc.Configuration> } | null = null

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(url.hostname)
}

/** Configuration découverte (mise en cache ; un échec n'est jamais mis en cache). */
export function getOidcConfiguration(config: OidcConfig, now = Date.now()): Promise<oidc.Configuration> {
  const key = `${config.issuer}|${config.clientId}`
  if (cached && cached.key === key && now - cached.at < DISCOVERY_TTL_MS) return cached.config
  const issuer = new URL(config.issuer)
  const promise = oidc.discovery(
    issuer,
    config.clientId,
    { client_secret: config.clientSecret },
    oidc.ClientSecretBasic(config.clientSecret),
    {
      timeout: HTTP_TIMEOUT_S,
      // http n'est accepté par loadConfig qu'en boucle locale (fournisseur sur la même machine, tests).
      execute: isLoopbackHttp(issuer) ? [oidc.allowInsecureRequests] : [],
    }
  )
  const entry = { key, at: now, config: promise }
  cached = entry
  // `timeout` s'applique aussi à toutes les requêtes suivantes de la Configuration.
  promise.catch(() => {
    if (cached === entry) cached = null
  })
  return promise
}

/** Tests uniquement. */
export function resetOidcCache(): void {
  cached = null
}

export interface AuthorizationRequest {
  url: string
  state: string
  nonce: string
  codeVerifier: string
}

/** URL d'autorisation (code + PKCE S256 + state + nonce). `reauth` : réauthentification forcée. */
export async function buildAuthorizationRequest(
  cfg: oidc.Configuration,
  config: OidcConfig,
  redirectUri: string,
  reauth: boolean
): Promise<AuthorizationRequest> {
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  const params: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: config.scopes,
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  }
  if (reauth) {
    // Confirmation d'une action sensible : le fournisseur doit redemander l'identification.
    params.prompt = 'login'
    params.max_age = '0'
  }
  return { url: oidc.buildAuthorizationUrl(cfg, params).href, state, nonce, codeVerifier }
}

export interface CodeExchangeResult {
  claims: Record<string, unknown>
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresAt: number
}

/**
 * Échange le code (vérifie state, nonce, PKCE, et le jeton d'identité : signature, iss,
 * aud, exp). `callbackUrl` : l'URL de retour réellement appelée (paramètres inclus).
 */
export async function exchangeCode(
  cfg: oidc.Configuration,
  callbackUrl: URL,
  checks: { state: string; nonce: string; codeVerifier: string; redirectUri: string },
  emailClaim: string,
  now = Date.now()
): Promise<CodeExchangeResult> {
  const tokens = await oidc.authorizationCodeGrant(
    cfg,
    callbackUrl,
    { pkceCodeVerifier: checks.codeVerifier, expectedState: checks.state, expectedNonce: checks.nonce, idTokenExpected: true },
    // redirect_uri exacte de la demande (derrière un proxy, l'URL vue par Nitro peut différer).
    { redirect_uri: checks.redirectUri }
  )
  const idClaims = tokens.claims()
  if (!idClaims) throw new Error('Jeton d\'identité absent')
  let claims: Record<string, unknown> = { ...idClaims }
  // Beaucoup de fournisseurs (Shibboleth, CAS, oidc-provider…) ne mettent les attributs
  // demandés par portée que dans UserInfo : on les y cherche, `sub` vérifié par openid-client.
  if (claims[emailClaim] === undefined && cfg.serverMetadata().userinfo_endpoint) {
    const info = await oidc.fetchUserInfo(cfg, tokens.access_token, idClaims.sub)
    claims = { ...info, ...claims }
  }
  return {
    claims,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: expiresAtFrom(tokens.expiresIn(), now),
  }
}

/** Rafraîchissement (refresh_token grant). Lève l'erreur du fournisseur telle quelle (voir isPermanentRefreshError). */
export async function refreshTokens(cfg: oidc.Configuration, refreshToken: string, now = Date.now()): Promise<RefreshedTokens> {
  const tokens = await oidc.refreshTokenGrant(cfg, refreshToken)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: expiresAtFrom(tokens.expiresIn(), now),
  }
}

/** URL de déconnexion chez le fournisseur, ou null s'il n'annonce pas d'end_session_endpoint. */
export function endSessionUrl(cfg: oidc.Configuration, idToken: string | undefined, postLogoutRedirectUri: string): string | null {
  if (!cfg.serverMetadata().end_session_endpoint) return null
  const params: Record<string, string> = { post_logout_redirect_uri: postLogoutRedirectUri }
  if (idToken) params.id_token_hint = idToken
  return oidc.buildEndSessionUrl(cfg, params).href
}
