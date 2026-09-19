/**
 * Remise à zéro du backend mémoire pour les suites E2E / a11y.
 *
 * Depuis R2, `POST /api/__mock/reset` remet aussi les préférences à zéro : la boîte
 * « Bienvenue » (première connexion) s'ouvrirait alors à chaque connexion et masquerait
 * la page. Les suites qui ne testent pas cette boîte marquent donc les comptes de test
 * comme « déjà accueillis » par l'API, avant toute connexion dans le navigateur.
 */
import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

// Même origine que l'application testée (E2E_BASE_URL), sinon le contrôle CSRF répond 403.
const ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin
const ACCOUNTS = [
  { email: 'dev@mmi-troyes.fr', password: 'dev-password' },
  { email: 'alice@mmi-troyes.fr', password: 'alice-password' },
]

export async function resetMock(request: APIRequestContext, opts: { welcomed?: boolean } = {}): Promise<void> {
  const res = await request.post('/api/__mock/reset', { headers: { origin: ORIGIN } })
  expect(res.status()).toBe(204)
  if (opts.welcomed === false) return

  for (const account of ACCOUNTS) {
    const login = await request.post('/api/auth/login', { data: account, headers: { origin: ORIGIN } })
    expect(login.status()).toBe(200)
    const prefs = await request.put('/api/prefs', { data: { welcomed: true }, headers: { origin: ORIGIN } })
    expect(prefs.status()).toBe(200)
    await request.post('/api/auth/logout', { headers: { origin: ORIGIN } })
  }
}
