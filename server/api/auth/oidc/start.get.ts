import { getConfig } from '../../../lib/config'
import { buildAuthorizationRequest, getOidcConfiguration } from '../../../lib/auth/oidc/client'
import { saveFlow } from '../../../lib/auth/oidc/flow'
import { safeReturnTo } from '../../../lib/auth/oidc/return-to'
import { deriveRedirectUri } from '../../../lib/auth/oidc/urls'
import { appBase, flowCookieOptions, requestOrigin } from '../../../utils/oidc-route'

/**
 * GET /api/auth/oidc/start[?returnTo=/chemin][&reauth=1] — redirige vers le fournisseur
 * d'identité (code d'autorisation + PKCE, state, nonce ; état dans un cookie scellé de
 * 10 minutes). `reauth=1` (session OIDC ouverte) : réauthentification forcée
 * (prompt=login, max_age=0) pour confirmer une action sensible. 404 sans AUTH_METHODS=oidc.
 */
export default defineEventHandler(async (event) => {
  const config = getConfig()
  if (!config.oidc) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const query = getQuery(event)
  const returnTo = safeReturnTo(query.returnTo)
  const base = appBase(event)

  // La réauthentification n'a de sens que pour une session déjà ouverte par OIDC.
  let reauth = false
  if (query.reauth === '1') {
    const session = await getUserSession(event)
    reauth = session.authMethod === 'oidc' && !!session.user?.email && !!session.secure?.sid
  }

  const redirectUri = config.oidc.redirectUrl ?? deriveRedirectUri(requestOrigin(event, config.trustProxy), base)
  let request
  try {
    const cfg = await getOidcConfiguration(config.oidc)
    request = await buildAuthorizationRequest(cfg, config.oidc, redirectUri, reauth)
  }
  catch (err) {
    console.error('[colombe] OIDC : découverte du fournisseur impossible', err instanceof Error ? err.message : typeof err)
    return sendRedirect(event, `${base}login?error=unavailable`, 302)
  }

  await saveFlow(event, flowCookieOptions(event), {
    state: request.state,
    nonce: request.nonce,
    codeVerifier: request.codeVerifier,
    redirectUri,
    returnTo,
    reauth,
    startedAt: Date.now(),
  })
  return sendRedirect(event, request.url, 302)
})
