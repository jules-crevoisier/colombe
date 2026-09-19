/**
 * État d'une connexion OIDC en cours, entre GET /api/auth/oidc/start et le retour du
 * fournisseur : state, nonce, vérificateur PKCE, destination. Cookie séparé de la session
 * (`wm_oidc`), scellé (chiffré + signé, même secret NUXT_SESSION_PASSWORD), httpOnly,
 * SameSite=Lax (le retour du fournisseur est une navigation GET intersite), 10 minutes,
 * usage unique (effacé au retour, qu'il réussisse ou non).
 */
import type { H3Event } from 'h3'
import { useSession } from 'h3'

export interface OidcFlowState {
  state: string
  nonce: string
  codeVerifier: string
  redirectUri: string
  returnTo: string | null
  /** Réauthentification d'une session existante (confirmation d'une action sensible). */
  reauth: boolean
  /** Début de la demande (ms) : `auth_time` doit être postérieur pour une réauthentification. */
  startedAt: number
}

export const FLOW_COOKIE = 'wm_oidc'
export const FLOW_TTL_S = 10 * 60

export interface FlowCookieOptions {
  password: string
  secure: boolean
  /** Chemin du cookie : le préfixe de déploiement (app.baseURL). */
  path: string
}

function flowSession(event: H3Event, opts: FlowCookieOptions) {
  return useSession<Partial<OidcFlowState>>(event, {
    name: FLOW_COOKIE,
    password: opts.password,
    maxAge: FLOW_TTL_S,
    sessionHeader: false,
    cookie: { httpOnly: true, secure: opts.secure, sameSite: 'lax', path: opts.path },
  })
}

export async function saveFlow(event: H3Event, opts: FlowCookieOptions, flow: OidcFlowState): Promise<void> {
  const session = await flowSession(event, opts)
  // Toutes les clés sont fournies : rien d'une demande précédente ne survit.
  await session.update({ ...flow })
}

/** Lit ET efface l'état (usage unique). null : absent, expiré ou illisible. */
export async function takeFlow(event: H3Event, opts: FlowCookieOptions, now = Date.now()): Promise<OidcFlowState | null> {
  const session = await flowSession(event, opts)
  const data = session.data
  await session.clear()
  if (!data.state || !data.nonce || !data.codeVerifier || !data.redirectUri || typeof data.startedAt !== 'number') return null
  if (now - data.startedAt > FLOW_TTL_S * 1000) return null
  return {
    state: data.state,
    nonce: data.nonce,
    codeVerifier: data.codeVerifier,
    redirectUri: data.redirectUri,
    returnTo: data.returnTo ?? null,
    reauth: data.reauth === true,
    startedAt: data.startedAt,
  }
}
