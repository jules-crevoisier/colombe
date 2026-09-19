/**
 * Langue de l'interface côté API : messages d'erreur selon Accept-Language (français
 * sans en-tête), préférence `language` du compte (auto | fr | en).
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { Prefs } from '#shared/types/mail'

const base = inject('apiBase')
const url = (path: string) => `${base}${path}`
const origin = () => new URL(url('/')).origin

async function post(path: string, body: unknown, headers: Record<string, string> = {}, cookie = ''): Promise<Response> {
  return fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin(), ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
}

async function login(): Promise<string> {
  const res = await post('/api/auth/login', { email: 'dev@universite.example', password: 'dev-password' })
  expect(res.status).toBe(200)
  return (res.headers.getSetCookie().find(v => v.startsWith('wm_session=')) ?? '').split(';')[0] ?? ''
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('messages d\'erreur selon Accept-Language', () => {
  const wrong = { email: 'dev@universite.example', password: 'mauvais-mot-de-passe' }

  it('garde le français sans en-tête Accept-Language', async () => {
    const res = await post('/api/auth/login', wrong)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { message: string }).message).toBe('Adresse ou mot de passe incorrect.')
  })

  it('répond en anglais à Accept-Language: en', async () => {
    const res = await post('/api/auth/login', wrong, { 'accept-language': 'en' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { message: string }).message).toBe('Incorrect address or password.')
  })

  it('suit l\'ordre de préférence de l\'en-tête (q)', async () => {
    const english = await post('/api/auth/login', wrong, { 'accept-language': 'de-DE, en-US;q=0.8, fr;q=0.5' })
    expect(((await english.json()) as { message: string }).message).toBe('Incorrect address or password.')
    const french = await post('/api/auth/login', wrong, { 'accept-language': 'en;q=0.3, fr-CA' })
    expect(((await french.json()) as { message: string }).message).toBe('Adresse ou mot de passe incorrect.')
  })

  it('traduit aussi les erreurs des routes authentifiées (dossier existant)', async () => {
    const cookie = await login()
    const created = await post('/api/folders', { name: 'Projets i18n' }, {}, cookie)
    expect(created.status).toBe(201)
    const again = await post('/api/folders', { name: 'Projets i18n' }, { 'accept-language': 'en-GB' }, cookie)
    expect(again.status).toBe(409)
    expect(((await again.json()) as { message: string }).message).toBe('A folder with this name already exists.')
  })
})

describe('préférence de langue du compte', () => {
  it('vaut « auto » par défaut, accepte fr et en, refuse le reste', async () => {
    const cookie = await login()
    const get = async (): Promise<Prefs> => {
      const res = await fetch(url('/api/prefs'), { headers: { cookie } })
      expect(res.status).toBe(200)
      return (await res.json()) as Prefs
    }
    expect((await get()).language).toBe('auto')

    const put = (language: string) => fetch(url('/api/prefs'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: origin(), cookie },
      body: JSON.stringify({ language }),
    })
    expect((await put('en')).status).toBe(200)
    expect((await get()).language).toBe('en')
    expect((await put('fr')).status).toBe(200)
    expect((await get()).language).toBe('fr')
    expect((await put('de')).status).toBe(400)
    expect((await get()).language).toBe('fr')
  })
})
