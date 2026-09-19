/**
 * Connexion unique OIDC : fonctions pures (adresse depuis les revendications, validation
 * de returnTo, URL de retour, rafraîchissement des jetons avec horloge injectée) et
 * magasin de sessions SSO.
 */
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../../../server/lib/config'
import { addressFromClaims } from '../../../server/lib/auth/oidc/claims'
import { safeReturnTo } from '../../../server/lib/auth/oidc/return-to'
import { DEFAULT_TOKEN_LIFETIME_MS, expiresAtFrom, isPermanentRefreshError, needsRefresh, refreshDueAt, REFRESH_MARGIN_MS, TokenRefresher } from '../../../server/lib/auth/oidc/refresh'
import type { OAuth2State, RefreshedTokens } from '../../../server/lib/auth/oidc/refresh'
import { appPageUrl, deriveRedirectUri, normalizeBase } from '../../../server/lib/auth/oidc/urls'
import { CredentialsStore } from '../../../server/lib/session/credentials'
import { hasRecentSsoReauth, SSO_REAUTH_WINDOW_MS } from '../../../server/lib/sieve/auth'

const single = loadConfig({ MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr' })
const multi = loadConfig({ MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr,etu.univ-exemple.fr', MAIL_LOGIN_DEFAULT_DOMAIN: 'none' })

describe('addressFromClaims', () => {
  it('prend la revendication configurée, en minuscules', () => {
    expect(addressFromClaims({ email: 'Jean.Dupont@Univ-Exemple.fr', email_verified: true }, 'email', single)).toEqual({ ok: true, email: 'jean.dupont@univ-exemple.fr' })
    expect(addressFromClaims({ preferred_username: 'jean.dupont@univ-exemple.fr' }, 'preferred_username', single)).toEqual({ ok: true, email: 'jean.dupont@univ-exemple.fr' })
  })

  it('sans @ : ajoute MAIL_LOGIN_DEFAULT_DOMAIN', () => {
    expect(addressFromClaims({ uid: 'jdupont' }, 'uid', single)).toEqual({ ok: true, email: 'jdupont@univ-exemple.fr' })
    // Pas de domaine par défaut : l'identifiant seul est refusé.
    expect(addressFromClaims({ uid: 'jdupont' }, 'uid', multi)).toEqual({ ok: false, reason: 'domain', value: 'jdupont' })
  })

  it('attribut multivalué (CAS/LDAP) : première valeur non vide', () => {
    expect(addressFromClaims({ mail: ['', 'jean.dupont@univ-exemple.fr', 'autre@univ-exemple.fr'] }, 'mail', single)).toEqual({ ok: true, email: 'jean.dupont@univ-exemple.fr' })
  })

  it('refuse un domaine étranger (MAIL_DOMAINS)', () => {
    expect(addressFromClaims({ email: 'pirate@gmail.com' }, 'email', single)).toEqual({ ok: false, reason: 'domain', value: 'pirate@gmail.com' })
    expect(addressFromClaims({ email: 'x@univ-exemple.fr.evil.com' }, 'email', single)).toMatchObject({ ok: false, reason: 'domain' })
  })

  it('refuse une revendication absente, vide ou non textuelle', () => {
    expect(addressFromClaims({}, 'email', single)).toEqual({ ok: false, reason: 'missing', value: '' })
    expect(addressFromClaims({ email: '   ' }, 'email', single)).toMatchObject({ ok: false, reason: 'missing' })
    expect(addressFromClaims({ email: 42 }, 'email', single)).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('refuse une adresse explicitement non vérifiée', () => {
    expect(addressFromClaims({ email: 'jean.dupont@univ-exemple.fr', email_verified: false }, 'email', single)).toMatchObject({ ok: false, reason: 'unverified' })
  })

  it('refuse les caractères dangereux (journaux, en-têtes)', () => {
    expect(addressFromClaims({ email: 'a\r\nb@univ-exemple.fr' }, 'email', single)).toMatchObject({ ok: false })
    expect(addressFromClaims({ email: 'a<b>@univ-exemple.fr' }, 'email', single)).toMatchObject({ ok: false })
  })
})

describe('safeReturnTo', () => {
  it('accepte un chemin relatif de l\'application', () => {
    expect(safeReturnTo('/mail/INBOX')).toBe('/mail/INBOX')
    expect(safeReturnTo('/settings?tab=forward')).toBe('/settings?tab=forward')
    expect(safeReturnTo('/mail/Dossier%20perso/12#x')).toBe('/mail/Dossier%20perso/12#x')
  })

  it('refuse toute redirection ouverte', () => {
    for (const bad of ['//evil.example', '//evil.example/mail', 'https://evil.example', 'http://evil.example/', '/\\evil.example', '\\\\evil.example', '/%5Cevil', 'javascript:alert(1)', 'mail/INBOX', '', ' /mail', '/mail\n/x', '/mail\t', '/api/auth/logout', '/api']) {
      const result = safeReturnTo(bad)
      // « /%5Cevil » reste un chemin local encodé : jamais une autre origine.
      if (result !== null) expect(result.startsWith('/') && !result.startsWith('//')).toBe(true)
      else expect(result).toBeNull()
    }
    expect(safeReturnTo('//evil.example')).toBeNull()
    expect(safeReturnTo('https://evil.example')).toBeNull()
    expect(safeReturnTo('/\\evil.example')).toBeNull()
    expect(safeReturnTo('/api/auth/logout')).toBeNull()
    expect(safeReturnTo(undefined)).toBeNull()
    expect(safeReturnTo(['/mail'])).toBeNull()
    expect(safeReturnTo(`/${'a'.repeat(2000)}`)).toBeNull()
  })

  it('normalise les segments « .. » sans sortir de l\'origine', () => {
    expect(safeReturnTo('/mail/../settings')).toBe('/settings')
    expect(safeReturnTo('/..//evil.example')).toBeNull()
  })
})

describe('URL de retour', () => {
  it('<origine><base>api/auth/oidc/callback', () => {
    expect(deriveRedirectUri('https://webmail.univ-exemple.fr', '/')).toBe('https://webmail.univ-exemple.fr/api/auth/oidc/callback')
    expect(deriveRedirectUri('https://www.univ-exemple.fr', '/colombe/')).toBe('https://www.univ-exemple.fr/colombe/api/auth/oidc/callback')
    expect(deriveRedirectUri('https://www.univ-exemple.fr', '/colombe')).toBe('https://www.univ-exemple.fr/colombe/api/auth/oidc/callback')
    expect(appPageUrl('https://www.univ-exemple.fr', '/colombe/', '/login')).toBe('https://www.univ-exemple.fr/colombe/login')
    expect(normalizeBase('')).toBe('/')
  })
})

describe('rafraîchissement des jetons (horloge injectée)', () => {
  const tokens = (at: number): RefreshedTokens => ({ accessToken: `at-${at}`, refreshToken: `rt-${at}`, expiresAt: at + 300_000 })

  it('échéance : une minute avant l\'expiration', () => {
    const auth = { expiresAt: 1_000_000 }
    expect(refreshDueAt(auth)).toBe(1_000_000 - REFRESH_MARGIN_MS)
    expect(needsRefresh(auth, 1_000_000 - REFRESH_MARGIN_MS - 1)).toBe(false)
    expect(needsRefresh(auth, 1_000_000 - REFRESH_MARGIN_MS)).toBe(true)
    expect(expiresAtFrom(300, 1000)).toBe(301_000)
    expect(expiresAtFrom(undefined, 1000)).toBe(1000 + DEFAULT_TOKEN_LIFETIME_MS)
    expect(expiresAtFrom(0, 1000)).toBe(1000 + DEFAULT_TOKEN_LIFETIME_MS)
  })

  it('ne rafraîchit pas un jeton encore frais', async () => {
    let now = 0
    const refresh = vi.fn(async () => tokens(now))
    const r = new TokenRefresher({ refresh, clock: { now: () => now } })
    const auth: OAuth2State = { accessToken: 'a', refreshToken: 'r', expiresAt: 300_000 }
    now = 200_000
    expect(await r.ensureFresh('sid', auth, () => {})).toBe('fresh')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('rafraîchit dans la marge, applique les nouveaux jetons, une seule fois pour des appels concurrents', async () => {
    let now = 0
    const refresh = vi.fn(async (rt: string) => {
      expect(rt).toBe('r')
      return tokens(now)
    })
    const r = new TokenRefresher({ refresh, clock: { now: () => now } })
    const auth: OAuth2State = { accessToken: 'a', refreshToken: 'r', expiresAt: 300_000 }
    const applied: RefreshedTokens[] = []
    now = 250_000
    const [a, b] = await Promise.all([
      r.ensureFresh('sid', auth, t => applied.push(t)),
      r.ensureFresh('sid', auth, t => applied.push(t)),
    ])
    expect([a, b]).toEqual(['refreshed', 'refreshed'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(applied).toEqual([{ accessToken: 'at-250000', refreshToken: 'rt-250000', expiresAt: 550_000 }])
  })

  it('sans jeton de rafraîchissement : utilisable jusqu\'à l\'expiration, puis expiré', async () => {
    let now = 0
    const refresh = vi.fn(async () => tokens(now))
    const r = new TokenRefresher({ refresh, clock: { now: () => now } })
    const auth: OAuth2State = { accessToken: 'a', expiresAt: 300_000 }
    now = 299_999
    expect(await r.ensureFresh('sid', auth, () => {})).toBe('fresh')
    now = 300_000
    expect(await r.ensureFresh('sid', auth, () => {})).toBe('expired')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refus définitif (invalid_grant) : expiré tout de suite ; panne passagère : jeton gardé tant qu\'il est valide', async () => {
    let now = 250_000
    const auth: OAuth2State = { accessToken: 'a', refreshToken: 'r', expiresAt: 300_000 }
    const revoked = new TokenRefresher({ refresh: async () => { throw Object.assign(new Error('refus'), { error: 'invalid_grant' }) }, clock: { now: () => now } })
    expect(await revoked.ensureFresh('sid', auth, () => {})).toBe('expired')

    const down = new TokenRefresher({ refresh: async () => { throw new TypeError('fetch failed') }, clock: { now: () => now } })
    expect(await down.ensureFresh('sid', auth, () => {})).toBe('fresh')
    now = 300_001
    expect(await down.ensureFresh('sid', auth, () => {})).toBe('expired')

    expect(isPermanentRefreshError({ error: 'invalid_grant' })).toBe(true)
    expect(isPermanentRefreshError({ cause: { error: 'invalid_grant' } })).toBe(true)
    expect(isPermanentRefreshError(new TypeError('fetch failed'))).toBe(false)
  })
})

describe('sessions SSO en mémoire (CredentialsStore)', () => {
  it('le rafraîchissement modifie EN PLACE l\'objet auth vu par les connexions existantes', () => {
    const store = new CredentialsStore({ now: () => 1000 })
    const sid = store.create('jean@univ-exemple.fr', { kind: 'oauth2', accessToken: 'a1', refreshToken: 'r1', expiresAt: 5000 }, '', '', { idToken: 'id1' })
    const held = store.get(sid)!
    expect(store.updateOAuth(sid, { accessToken: 'a2', expiresAt: 9000, idToken: 'id2' })).toBe(true)
    expect(held.auth).toEqual({ kind: 'oauth2', accessToken: 'a2', refreshToken: 'r1', expiresAt: 9000 })
    expect(store.getSso(sid)).toEqual({ idToken: 'id2' })
    store.destroy()
  })

  it('une session par mot de passe n\'a ni données SSO ni jetons', () => {
    const store = new CredentialsStore({ now: () => 1000 })
    const sid = store.create('jean@univ-exemple.fr', 'secret')
    expect(store.getSso(sid)).toBeNull()
    expect(store.updateOAuth(sid, { accessToken: 'x', expiresAt: 1 })).toBe(false)
    expect(store.get(sid)?.auth).toEqual({ kind: 'password', password: 'secret' })
    store.destroy()
  })

  it('réauthentification : fenêtre de 5 minutes', () => {
    let now = 10_000
    const store = new CredentialsStore({ now: () => now })
    const sid = store.create('jean@univ-exemple.fr', { kind: 'master' }, '', '', {})
    expect(hasRecentSsoReauth(store.getSso(sid)?.reauthAt, now)).toBe(false)
    expect(store.markReauth(sid)).toBe(true)
    now += SSO_REAUTH_WINDOW_MS - 1
    expect(hasRecentSsoReauth(store.getSso(sid)?.reauthAt, now)).toBe(true)
    now += 1
    expect(hasRecentSsoReauth(store.getSso(sid)?.reauthAt, now)).toBe(false)
    // Horodatage dans le futur : refusé.
    expect(hasRecentSsoReauth(now + 1000, now)).toBe(false)
    expect(store.markReauth('inconnu')).toBe(false)
    store.destroy()
  })
})
