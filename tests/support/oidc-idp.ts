/**
 * Fournisseur OpenID Connect de test, en processus (oidc-provider, panva, MIT) : aucune
 * dépendance à Docker. Connexion automatique : chaque interaction « login » est validée
 * pour le compte choisi par le test (`idp.loginAs(...)`), sans formulaire.
 *
 * Comportement proche des fournisseurs réels visés : code + PKCE, jeton de rafraîchissement
 * (comme Keycloak, même sans offline_access), attributs « email » servis par UserInfo
 * (conformIdTokenClaims par défaut), déconnexion RP-initiated (end_session_endpoint).
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import Provider from 'oidc-provider'

export interface TestAccount {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
}

export interface TestIdp {
  issuer: string
  /** Compte utilisé par la prochaine interaction de connexion. */
  loginAs: (account: TestAccount) => void
  /** Nombre d'interactions de connexion traitées (prompt=login compris). */
  logins: () => number
  /** Nombre de rafraîchissements (grant_type=refresh_token) réussis. */
  refreshes: () => number
  close: () => Promise<void>
}

export interface TestIdpOptions {
  clientId: string
  clientSecret: string
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  /** Durée de vie des jetons d'accès (secondes). */
  accessTokenTtl?: number
}

export async function startTestIdp(opts: TestIdpOptions): Promise<TestIdp> {
  const accounts = new Map<string, TestAccount>()
  let current: TestAccount = { sub: 'nobody' }
  let loginCount = 0

  const server: Server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const issuer = `http://127.0.0.1:${port}`

  const provider = new Provider(issuer, {
    clients: [{
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uris: opts.redirectUris,
      post_logout_redirect_uris: opts.postLogoutRedirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    }],
    claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name'] },
    cookies: { keys: ['colombe-test-idp-cookie-key-0123456789'] },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: true },
    },
    ttl: { AccessToken: opts.accessTokenTtl ?? 300, IdToken: 300, Interaction: 600, Session: 3600, Grant: 3600, RefreshToken: 3600, AuthorizationCode: 60 },
    interactions: { url: (_ctx: unknown, interaction: { uid: string }) => `/interaction/${interaction.uid}` },
    // Client de confiance (comme Colombe déclaré par l'établissement) : pas d'écran de consentement.
    loadExistingGrant: async (ctx: { oidc: { client: { clientId: string }; session: { accountId?: string }; params: { scope?: string }; provider: { Grant: new (init: { clientId: string; accountId?: string }) => { addOIDCScope: (s: string) => void; save: () => Promise<string> } } } }) => {
      const grant = new ctx.oidc.provider.Grant({ clientId: ctx.oidc.client.clientId, accountId: ctx.oidc.session.accountId })
      grant.addOIDCScope(ctx.oidc.params.scope ?? 'openid')
      await grant.save()
      return grant
    },
    issueRefreshToken: async (_ctx: unknown, client: { grantTypeAllowed: (t: string) => boolean }) => client.grantTypeAllowed('refresh_token'),
    findAccount: async (_ctx: unknown, id: string) => {
      const account = accounts.get(id)
      if (!account) return undefined
      return { accountId: id, claims: async () => ({ ...account }) }
    },
  })
  // Journaux d'erreurs du fournisseur : utiles si un test échoue, silencieux sinon.
  provider.on('server_error', (_ctx: unknown, err: Error) => console.error('[idp] server_error', err))
  let refreshCount = 0
  provider.on('grant.success', (ctx: { oidc: { params?: { grant_type?: string } } }) => {
    if (ctx.oidc.params?.grant_type === 'refresh_token') refreshCount += 1
  })

  const callback = provider.callback()
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.startsWith('/interaction/')) {
      void (async () => {
        try {
          await provider.interactionDetails(req, res)
          loginCount += 1
          accounts.set(current.sub, current)
          await provider.interactionFinished(req, res, { login: { accountId: current.sub } }, { mergeWithLastSubmission: false })
        }
        catch (err) {
          res.statusCode = 500
          res.end(String(err))
        }
      })()
      return
    }
    callback(req, res)
  })

  return {
    issuer,
    loginAs: (account) => {
      current = account
      accounts.set(account.sub, account)
    },
    logins: () => loginCount,
    refreshes: () => refreshCount,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}
