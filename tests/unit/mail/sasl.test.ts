/**
 * Cadrage SASL des sessions OIDC : XOAUTH2 (format Google), OAUTHBEARER (RFC 7628),
 * PLAIN avec authzid (utilisateur maître Dovecot), et leur usage par IMAP, SMTP et
 * ManageSieve (trame vérifiée sur un faux socket).
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { MailServerConfig } from '../../../server/lib/mail/backend'
import { gs2SaslName, imapAuth, OAUTHBEARER_ABORT, oauthbearerPayload, oauthbearerToken, plainToken, SMTP_CUSTOM_AUTH, smtpAuth, xoauth2Payload, xoauth2Token } from '../../../server/lib/mail/sasl'
import { SieveClient, SieveError } from '../../../server/lib/sieve/client'
import type { SieveDuplex } from '../../../server/lib/sieve/client'
import { sieveCredentials } from '../../../server/lib/sieve/auth'

const SOH = String.fromCharCode(1)
const NUL = String.fromCharCode(0)
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

describe('XOAUTH2 (format Google)', () => {
  it('user=<u>^Aauth=Bearer <t>^A^A', () => {
    expect(xoauth2Payload('jean@univ.fr', 'ya29.tok')).toBe(`user=jean@univ.fr${SOH}auth=Bearer ya29.tok${SOH}${SOH}`)
    // Exemple de la documentation Google (someuser@example.com / ya29.vF9dft4qmTc2Nvb3RlckBhdHRhdmlzdGEuY29tCg).
    expect(xoauth2Token('someuser@example.com', 'ya29.vF9dft4qmTc2Nvb3RlckBhdHRhdmlzdGEuY29tCg'))
      .toBe('dXNlcj1zb21ldXNlckBleGFtcGxlLmNvbQFhdXRoPUJlYXJlciB5YTI5LnZGOWRmdDRxbVRjMk52YjNSbGNrQmhkSFJoZG1semRHRXVZMjl0Q2cBAQ==')
  })
})

describe('OAUTHBEARER (RFC 7628)', () => {
  it('n,a=<u>,^Ahost=<h>^Aport=<p>^Aauth=Bearer <t>^A^A', () => {
    expect(oauthbearerPayload('user@example.com', 'vF9dft4qmTc2Nvb3RlckBhbHRhdmlzdGEuY29tCg==', 'server.example.com', 143))
      .toBe(`n,a=user@example.com,${SOH}host=server.example.com${SOH}port=143${SOH}auth=Bearer vF9dft4qmTc2Nvb3RlckBhbHRhdmlzdGEuY29tCg==${SOH}${SOH}`)
    // RFC 7628 §4.1 (exemple IMAP, réponse initiale).
    expect(oauthbearerToken('user@example.com', 'vF9dft4qmTc2Nvb3RlckBhbHRhdmlzdGEuY29tCg==', 'server.example.com', 143))
      .toBe('bixhPXVzZXJAZXhhbXBsZS5jb20sAWhvc3Q9c2VydmVyLmV4YW1wbGUuY29tAXBvcnQ9MTQzAWF1dGg9QmVhcmVyIHZGOWRmdDRxbVRjMk52YjNSbGNrQmhiSFJoZG1semRHRXVZMjl0Q2c9PQEB')
  })

  it('échappe « , » et « = » dans le nom (RFC 5801 saslname)', () => {
    expect(gs2SaslName('a,b=c@x')).toBe('a=2Cb=3Dc@x')
    expect(oauthbearerPayload('a,b@x', 't', 'h', 1).startsWith('n,a=a=2Cb@x,')).toBe(true)
  })

  it('abandon après un défi d\'erreur : un seul octet 0x01', () => {
    expect(Buffer.from(OAUTHBEARER_ABORT, 'base64').toString()).toBe(SOH)
  })
})

describe('PLAIN (RFC 4616) et utilisateur maître', () => {
  it('authzid NUL authcid NUL mot de passe', () => {
    expect(plainToken('', 'jean', 'pw')).toBe(b64(`${NUL}jean${NUL}pw`))
    expect(plainToken('jean@univ.fr', 'colombe', 'maitre')).toBe(b64(`jean@univ.fr${NUL}colombe${NUL}maitre`))
  })
})

const server: MailServerConfig = {
  imapHost: 'mail.univ.fr',
  imapPort: 993,
  imapSecure: true,
  imapServername: 'mail.univ.fr',
  smtpHost: '127.0.0.1',
  smtpPort: 587,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpServername: 'mail.univ.fr',
  loginUsername: 'email',
  mailSso: null,
}
const masterSso = { mode: 'master' as const, masterUser: 'colombe', masterPassword: 'm'.repeat(24), separator: '*' }

describe('IMAP (imapflow)', () => {
  it('mot de passe, jeton, utilisateur maître', () => {
    expect(imapAuth({ email: 'jean@univ.fr', auth: { kind: 'password', password: 'pw' } }, server)).toEqual({ user: 'jean@univ.fr', pass: 'pw' })
    expect(imapAuth({ email: 'jean@univ.fr', auth: { kind: 'oauth2', accessToken: 'tok', expiresAt: 0 } }, { ...server, mailSso: { mode: 'oauth2', mechanism: 'xoauth2' } }))
      .toEqual({ user: 'jean@univ.fr', accessToken: 'tok' })
    expect(imapAuth({ email: 'jean@univ.fr', auth: { kind: 'master' } }, { ...server, mailSso: masterSso }))
      .toEqual({ user: 'jean@univ.fr*colombe', pass: 'm'.repeat(24) })
    // MAIL_LOGIN_USERNAME=localpart : partie avant @, y compris derrière le séparateur maître.
    expect(imapAuth({ email: 'jean@univ.fr', auth: { kind: 'master' } }, { ...server, loginUsername: 'localpart', mailSso: masterSso }))
      .toEqual({ user: 'jean*colombe', pass: 'm'.repeat(24) })
    expect(() => imapAuth({ email: 'jean@univ.fr', auth: { kind: 'master' } }, server)).toThrow()
  })
})

describe('SMTP (nodemailer)', () => {
  it('mot de passe : identifiants classiques', () => {
    expect(smtpAuth({ email: 'jean@univ.fr', auth: { kind: 'password', password: 'pw' } }, server)).toEqual({ auth: { user: 'jean@univ.fr', pass: 'pw' } })
  })

  it('XOAUTH2 : AUTH XOAUTH2, puis le jeton sur sa propre ligne (jamais en réponse initiale : ligne trop longue)', async () => {
    const opts = smtpAuth({ email: 'jean@univ.fr', auth: { kind: 'oauth2', accessToken: 'tok', expiresAt: 0 } }, { ...server, mailSso: { mode: 'oauth2', mechanism: 'xoauth2' } })
    expect(opts.auth).toEqual({ type: 'custom', method: SMTP_CUSTOM_AUTH.xoauth2, user: 'jean@univ.fr' })
    const handler = opts.customAuth![SMTP_CUSTOM_AUTH.xoauth2]!

    const sent: string[] = []
    expect(await runHandler(handler, sent, [334, 235])).toBe(true)
    expect(sent).toEqual(['AUTH XOAUTH2', xoauth2Token('jean@univ.fr', 'tok')])

    // Refus : défi d'erreur JSON, abandon par ligne vide, 535.
    const refused: string[] = []
    expect(await runHandler(handler, refused, [334, 334, 535])).toBe(false)
    expect(refused).toEqual(['AUTH XOAUTH2', xoauth2Token('jean@univ.fr', 'tok'), ''])
  })

  it('OAUTHBEARER : AUTH OAUTHBEARER, jeton RFC 7628 (hôte = nom TLS, port SMTP), abandon ^A', async () => {
    const opts = smtpAuth({ email: 'jean@univ.fr', auth: { kind: 'oauth2', accessToken: 'tok', expiresAt: 0 } }, { ...server, mailSso: { mode: 'oauth2', mechanism: 'oauthbearer' } })
    expect(opts.auth).toEqual({ type: 'custom', method: SMTP_CUSTOM_AUTH.oauthbearer, user: 'jean@univ.fr' })
    const handler = opts.customAuth![SMTP_CUSTOM_AUTH.oauthbearer]!

    const sent: string[] = []
    expect(await runHandler(handler, sent, [334, 235])).toBe(true)
    expect(sent).toEqual(['AUTH OAUTHBEARER', oauthbearerToken('jean@univ.fr', 'tok', 'mail.univ.fr', 587)])

    const refused: string[] = []
    expect(await runHandler(handler, refused, [334, 334, 535])).toBe(false)
    expect(refused[2]).toBe(OAUTHBEARER_ABORT)
    // Mécanisme non proposé par le serveur : échec immédiat.
    expect(await runHandler(handler, [], [504])).toBe(false)
  })

  it('maître : AUTH PLAIN authzid=utilisateur, authcid=maître', async () => {
    const opts = smtpAuth({ email: 'jean@univ.fr', auth: { kind: 'master' } }, { ...server, mailSso: masterSso })
    const sent: string[] = []
    expect(await runHandler(opts.customAuth![SMTP_CUSTOM_AUTH.master]!, sent, [334, 235])).toBe(true)
    expect(sent).toEqual(['AUTH PLAIN', plainToken('jean@univ.fr', 'colombe', 'm'.repeat(24))])
  })
})

/** Exécute un gestionnaire customAuth de nodemailer contre des codes de réponse scriptés. */
async function runHandler(handler: NonNullable<ReturnType<typeof smtpAuth>['customAuth']>[string], sent: string[], statuses: number[]): Promise<boolean> {
  const queue = [...statuses]
  const ctx = {
    auth: { credentials: { user: '', pass: '' } },
    method: 'X',
    extensions: [],
    authMethods: [],
    maxAllowedSize: false as const,
    sendCommand: (cmd: string) => {
      sent.push(cmd)
      const status = queue.shift() ?? 535
      return Promise.resolve({ command: cmd, response: `${status} réponse`, status, text: 'réponse' })
    },
    resolve: () => {},
    reject: () => {},
  }
  try {
    await handler(ctx as unknown as Parameters<typeof handler>[0])
    return true
  }
  catch {
    return false
  }
}

// ─── ManageSieve : trame AUTHENTICATE sur un faux socket ───

class FakeSocket extends EventEmitter implements SieveDuplex {
  written: string[] = []
  constructor(private readonly reply: (line: string) => string | null) {
    super()
  }

  write(data: Buffer): boolean {
    const line = data.toString('utf-8')
    this.written.push(line)
    const answer = this.reply(line)
    if (answer !== null) setImmediate(() => this.emit('data', Buffer.from(answer, 'utf-8')))
    return true
  }

  end(): void {}
  destroy(): void {}
}

const sieveConfig = { host: '127.0.0.1', port: 4190, rejectUnauthorized: true, servername: 'mail.univ.fr' }

describe('ManageSieve AUTHENTICATE', () => {
  it('XOAUTH2 : réponse initiale, succès', async () => {
    const socket = new FakeSocket(() => 'OK "Logged in."\r\n')
    const client = SieveClient.fromSocket(sieveConfig, socket)
    await client.login({ kind: 'xoauth2', user: 'jean@univ.fr', accessToken: 'tok' })
    expect(socket.written).toEqual([`AUTHENTICATE "XOAUTH2" "${xoauth2Token('jean@univ.fr', 'tok')}"\r\n`])
  })

  it('OAUTHBEARER : hôte = nom du certificat, port ManageSieve', async () => {
    const socket = new FakeSocket(() => 'OK\r\n')
    const client = SieveClient.fromSocket(sieveConfig, socket)
    await client.login({ kind: 'oauthbearer', user: 'jean@univ.fr', accessToken: 'tok' })
    expect(socket.written).toEqual([`AUTHENTICATE "OAUTHBEARER" "${oauthbearerToken('jean@univ.fr', 'tok', 'mail.univ.fr', 4190)}"\r\n`])
  })

  it('échec OAuth : défi JSON, abandon, puis NO → AUTH_FAILED (jamais de blocage)', async () => {
    const socket = new FakeSocket(line => (line.startsWith('AUTHENTICATE') ? `"${b64('{"status":"invalid_token"}')}"\r\n` : 'NO "Authentication failed"\r\n'))
    const client = SieveClient.fromSocket(sieveConfig, socket)
    const err = await client.login({ kind: 'oauthbearer', user: 'jean@univ.fr', accessToken: 'bad' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SieveError)
    expect((err as SieveError).code).toBe('AUTH_FAILED')
    expect(socket.written[1]).toBe(`"${OAUTHBEARER_ABORT}"\r\n`)
  })

  it('XOAUTH2 refusé : abandon par chaîne vide', async () => {
    const socket = new FakeSocket(line => (line.startsWith('AUTHENTICATE') ? `"${b64('{"status":"401"}')}"\r\n` : 'NO\r\n'))
    const client = SieveClient.fromSocket(sieveConfig, socket)
    await expect(client.login({ kind: 'xoauth2', user: 'jean@univ.fr', accessToken: 'bad' })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(socket.written[1]).toBe('""\r\n')
  })

  it('PLAIN maître : authzid = utilisateur, authcid = maître', async () => {
    const socket = new FakeSocket(() => 'OK\r\n')
    const client = SieveClient.fromSocket(sieveConfig, socket)
    await client.login({ kind: 'plain', user: 'colombe', password: 'm'.repeat(24), authzid: 'jean@univ.fr' })
    expect(socket.written).toEqual([`AUTHENTICATE "PLAIN" "${plainToken('jean@univ.fr', 'colombe', 'm'.repeat(24))}"\r\n`])
  })

  it('identifiants ManageSieve selon le type de session', () => {
    const cfg = { loginUsername: 'email' as const, mailSso: null }
    expect(sieveCredentials({ email: 'jean@univ.fr', auth: { kind: 'password', password: 'pw' } }, cfg)).toEqual({ kind: 'plain', user: 'jean@univ.fr', password: 'pw' })
    expect(sieveCredentials({ email: 'jean@univ.fr', auth: { kind: 'oauth2', accessToken: 't', expiresAt: 0 } }, { ...cfg, mailSso: { mode: 'oauth2', mechanism: 'oauthbearer' } }))
      .toEqual({ kind: 'oauthbearer', user: 'jean@univ.fr', accessToken: 't' })
    expect(sieveCredentials({ email: 'jean@univ.fr', auth: { kind: 'master' } }, { ...cfg, mailSso: masterSso }))
      .toEqual({ kind: 'plain', user: 'colombe', password: 'm'.repeat(24), authzid: 'jean@univ.fr' })
  })
})
