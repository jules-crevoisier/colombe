/**
 * Double authentification TOTP, de bout en bout sur le serveur construit.
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { LoginResult, TwoFactorSetup, TwoFactorStatus } from '#shared/types/mail'
import { totpAt } from '../../server/lib/auth/totp'

const base = inject('apiBase')
const url = (path: string) => `${base}${path}`
const origin = () => new URL(base).origin
const now = () => Math.floor(Date.now() / 1000)

class Client {
  cookie = ''
  async req(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {}
    if (this.cookie) headers.cookie = this.cookie
    if (method !== 'GET') headers.origin = origin()
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const set = res.headers.getSetCookie().find(v => v.startsWith('wm_session='))
    if (set) this.cookie = set.split(';')[0] ?? ''
    return res
  }

  async login(): Promise<LoginResult> {
    const res = await this.req('/api/auth/login', 'POST', { email: 'dev@universite.example', password: 'dev-password' })
    expect(res.status).toBe(200)
    return (await res.json()) as LoginResult
  }
}

async function enroll(c: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = (await (await c.req('/api/account/2fa/setup', 'POST')).json()) as TwoFactorSetup
  const res = await c.req('/api/account/2fa/enable', 'POST', { code: totpAt(setup.secret, now()) })
  expect(res.status).toBe(200)
  const { recoveryCodes } = (await res.json()) as { recoveryCodes: string[] }
  return { secret: setup.secret, recoveryCodes }
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('2FA', () => {
  it('should enroll with a QR code generated locally and refuse a wrong confirmation code', async () => {
    const c = new Client()
    await c.login()
    expect((await (await c.req('/api/account/2fa')).json()) as TwoFactorStatus).toEqual({ enabled: false, recoveryCodesLeft: 0 })

    const setupRes = await c.req('/api/account/2fa/setup', 'POST')
    expect(setupRes.status).toBe(200)
    const setup = (await setupRes.json()) as TwoFactorSetup
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.qrSvg.startsWith('<svg')).toBe(true)
    expect(setup.qrSvg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`)

    expect((await c.req('/api/account/2fa/enable', 'POST', { code: '000000' })).status).toBe(400)
    const ok = await c.req('/api/account/2fa/enable', 'POST', { code: totpAt(setup.secret, now()) })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10)
    expect((await (await c.req('/api/account/2fa')).json()) as TwoFactorStatus).toEqual({ enabled: true, recoveryCodesLeft: 10 })
  })

  it('should require the code after the password, and never open the mailbox before', async () => {
    const setupClient = new Client()
    await setupClient.login()
    const { secret } = await enroll(setupClient)

    const c = new Client()
    expect(await c.login()).toEqual({ twoFactorRequired: true })
    expect((await c.req('/api/folders')).status).toBe(401)
    const session = (await (await c.req('/api/_auth/session')).json()) as Record<string, unknown>
    expect(session.user).toBeUndefined()

    const wrong = await c.req('/api/auth/2fa', 'POST', { code: '000000' })
    expect(wrong.status).toBe(401)
    // Le code d'activation (pas courant) est déjà consommé : on prend le pas suivant, toléré (±1).
    const good = await c.req('/api/auth/2fa', 'POST', { code: totpAt(secret, now() + 30) })
    expect(good.status).toBe(200)
    expect((await good.json()) as LoginResult).toEqual({ user: { email: 'dev@universite.example' } })
    expect((await c.req('/api/folders')).status).toBe(200)

    // Rejeu du même code sur une nouvelle connexion : refusé.
    const replay = new Client()
    await replay.login()
    expect((await replay.req('/api/auth/2fa', 'POST', { code: totpAt(secret, now() + 30) })).status).toBe(401)
  })

  it('should accept each recovery code once', async () => {
    const setupClient = new Client()
    await setupClient.login()
    const { recoveryCodes } = await enroll(setupClient)
    const code = recoveryCodes[0] ?? ''

    const first = new Client()
    await first.login()
    expect((await first.req('/api/auth/2fa', 'POST', { code })).status).toBe(200)

    const second = new Client()
    await second.login()
    expect((await second.req('/api/auth/2fa', 'POST', { code })).status).toBe(401)
    expect((await (await first.req('/api/account/2fa')).json()) as TwoFactorStatus).toEqual({ enabled: true, recoveryCodesLeft: 9 })
  })

  it('should drop the pending login after 5 wrong codes', async () => {
    const setupClient = new Client()
    await setupClient.login()
    const { secret } = await enroll(setupClient)

    const c = new Client()
    await c.login()
    for (let i = 0; i < 4; i++) expect((await c.req('/api/auth/2fa', 'POST', { code: '111111' })).status).toBe(401)
    const fifth = await c.req('/api/auth/2fa', 'POST', { code: '111111' })
    expect(fifth.status).toBe(401)
    expect(((await fifth.json()) as { message: string }).message).toContain('Reconnectez-vous')
    // Même avec un bon code, l'attente est invalidée.
    expect((await c.req('/api/auth/2fa', 'POST', { code: totpAt(secret, now() + 30) })).status).toBe(401)
  })

  it('should only disable with a valid code', async () => {
    const c = new Client()
    await c.login()
    const { recoveryCodes } = await enroll(c)
    expect((await c.req('/api/account/2fa/disable', 'POST', { code: '000000' })).status).toBe(400)
    expect((await c.req('/api/account/2fa/disable', 'POST', { code: recoveryCodes[1] })).status).toBe(204)
    expect(await new Client().login()).toEqual({ user: { email: 'dev@universite.example' } })
  })
})
