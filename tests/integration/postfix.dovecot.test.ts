/**
 * Intégration réelle de la soumission SMTP par connexion unique à travers un vrai Postfix
 * (pas la soumission Dovecot utilisée par les autres bancs) : Postfix délègue l'AUTH SASL à
 * Dovecot 2.4 (`smtpd_sasl_type = dovecot`, socket TCP `service auth { inet_listener {} }`,
 * conteneurs séparés — voir docker-compose.postfix.yml, tests/integration/postfix/), Dovecot
 * validant le jeton par introspection Keycloak (même royaume que docker-compose.sso.yml,
 * mêmes comptes dev/alice). Voir docs/admin/connexion-unique.md, §Postfix (soumission SMTP).
 *
 * Ne teste QUE l'envoi (SMTP) : ce banc n'expose pas IMAP/ManageSieve, Postfix n'intervenant
 * jamais dans ces protocoles côté Colombe.
 *
 * Lancer : docker compose -f docker-compose.postfix.yml up -d --wait --build, puis
 * `pnpm test:postfix`. Ignoré automatiquement si Keycloak (localhost:8380) ou Postfix
 * (127.0.0.1:3590) n'écoutent pas.
 */
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import type { MailCredentials, MailServerConfig } from '../../server/lib/mail/backend'
import { ImapBackend } from '../../server/lib/mail/imap'

const KEYCLOAK = 'http://localhost:8380'
const ISSUER = `${KEYCLOAK}/realms/colombe`
const CLIENT_ID = 'colombe'
const CLIENT_SECRET = 'colombe-sso-test-secret'
const MAILPIT = 'http://127.0.0.1:18028'
const DEV = { user: 'dev', password: 'dev-sso-password', email: 'dev@universite.example' }
const ALICE = { user: 'alice', password: 'alice-sso-password', email: 'alice@universite.example' }

function listening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host)
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

const reachable = (await listening(8380)) && (await listening(3590))

/** Config Colombe pointée sur le Postfix du banc (IMAP inutilisé, jamais interrogé par `.send()`). */
const postfixServer = (mechanism: 'xoauth2' | 'oauthbearer'): MailServerConfig => ({
  imapHost: '127.0.0.1',
  imapPort: 3145, // non utilisé par send() ; port arbitraire, aucune connexion IMAP dans ce banc.
  imapSecure: false,
  imapServername: 'localhost',
  smtpHost: '127.0.0.1',
  smtpPort: 3590,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpServername: 'localhost',
  tlsRejectUnauthorized: false, // certificat auto-signé du conteneur Postfix de test
  loginUsername: 'email',
  mailSso: { mode: 'oauth2', mechanism },
})

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number }

/** Jeton Keycloak réel (grant « password », activé pour le seul client de test). */
async function keycloakToken(account: { user: string; password: string }): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, username: account.user, password: account.password, scope: 'openid email' }),
  })
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as TokenResponse
}

function oauth2Creds(email: string, token: TokenResponse): MailCredentials {
  return { email, auth: { kind: 'oauth2', accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 } }
}

async function mailpitSubjects(): Promise<string[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`)
  const body = (await res.json()) as { messages: { Subject: string }[] }
  return body.messages.map(m => m.Subject)
}

async function waitForMailpit(subject: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if ((await mailpitSubjects()).includes(subject)) return
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`« ${subject} » n'est jamais arrivé dans Mailpit (relayé par Postfix)`)
}

const unique = (label: string) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const rawMessage = (from: string, to: string, subject: string) =>
  Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Date.now()}@colombe.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEnvoyé via Postfix (smtpd_sasl_type = dovecot).\r\n`)

describe.skipIf(!reachable)('SSO réel : soumission SMTP via un vrai Postfix (smtpd_sasl_type = dovecot)', () => {
  it('AUTH XOAUTH2 puis AUTH OAUTHBEARER (défi 334 en deux temps) : message relayé jusqu\'à Mailpit', async () => {
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      const token = await keycloakToken(DEV)
      // Un vrai jeton Keycloak (JWT) tient largement sous line_length_limit = 2048 de
      // Postfix (voir tests/integration/postfix/main.cf) — vérifié ici, pas supposé.
      expect(token.access_token.length).toBeGreaterThan(200)
      expect(token.access_token.length).toBeLessThan(2048)
      const backend = new ImapBackend(oauth2Creds(DEV.email, token), postfixServer(mechanism))
      const subject = unique(`Postfix ${mechanism}`)
      try {
        await backend.send(rawMessage(DEV.email, ALICE.email, subject), { from: DEV.email, to: [ALICE.email] })
      }
      finally {
        await backend.close()
      }
      await waitForMailpit(subject)
    }
  })

  it('un jeton invalide est refusé par Postfix (AUTH_FAILED), rien n\'est relayé', async () => {
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      const backend = new ImapBackend(oauth2Creds(DEV.email, { access_token: 'jeton-invalide', refresh_token: '', expires_in: 60 }), postfixServer(mechanism))
      const subject = unique('Postfix refusé')
      await expect(backend.send(rawMessage(DEV.email, ALICE.email, subject), { from: DEV.email, to: [ALICE.email] })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
      await backend.close()
      expect(await mailpitSubjects()).not.toContain(subject)
    }
  })

  it('le jeton d\'un autre utilisateur (pour un envoi « as » dev) est refusé', async () => {
    const aliceToken = await keycloakToken(ALICE)
    const backend = new ImapBackend(oauth2Creds(DEV.email, aliceToken), postfixServer('xoauth2'))
    const subject = unique('Postfix usurpation')
    await expect(backend.send(rawMessage(DEV.email, ALICE.email, subject), { from: DEV.email, to: [ALICE.email] })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    await backend.close()
  })
})
