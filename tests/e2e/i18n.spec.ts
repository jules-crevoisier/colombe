/**
 * Interface en anglais (navigateur en-US) et choix de la langue, en boîte noire :
 * page de connexion, erreur du serveur traduite, Paramètres → Général → Langue,
 * <html lang>, libellés principaux et toasts. Mobile 320 px et bureau 1440 px.
 *
 * Deux autres blocs (navigateur français par défaut, config Playwright — `locale:
 * 'fr-FR'`) couvrent le choix fait sur la page de connexion quand la préférence du
 * compte est encore « auto » : il doit s'appliquer tout de suite, survivre à un
 * rechargement, et se recopier comme préférence du compte (suit sur tout appareil) —
 * jamais l'inverse quand le compte a déjà une préférence fr/en explicite.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetMock } from '../support/reset'

const DEV = { email: 'dev@universite.example', password: 'dev-password' }
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024

async function signIn(page: Page, password = DEV.password) {
  await page.getByLabel('Email address').fill(DEV.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function signInFr(page: Page, password = DEV.password) {
  await page.getByLabel('Adresse e-mail').fill(DEV.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
}

async function chooseLanguage(page: Page, option: 'Automatic (browser language)' | 'Automatique (langue du navigateur)' | 'Français' | 'English') {
  await page.getByLabel('Langue / Language').click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.beforeEach(async ({ request }) => {
  await resetMock(request)
})

test.describe('navigateur anglais (en-US)', () => {
  test.use({ locale: 'en-US' })

  test('i18n-1. navigateur anglais : connexion en anglais, erreur du serveur en anglais', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page).toHaveTitle(/^Sign in — /)
    await expect(page.getByText('Never enter your password on a page you reached from an email.', { exact: false })).toBeVisible()

    // Mauvais mot de passe : le message vient du serveur (Accept-Language: en).
    const response = page.waitForResponse(r => r.url().includes('/api/auth/login'))
    await signIn(page, 'wrong-password')
    const res = await response
    expect(res.status()).toBe(401)
    expect(((await res.json()) as { message: string }).message).toBe('Incorrect address or password.')
    expect(res.request().headers()['accept-language']).toBe('en')
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect address or password.' })).toBeVisible()
  })

  test('i18n-2. après connexion : libellés anglais, bascule Français puis English sans rechargement', async ({ page }) => {
    await page.goto('/login')
    await signIn(page)
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('button', { name: 'New message', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Inbox' }).first()).toBeVisible()
    if (!isMobile(page)) await expect(page.getByRole('link', { name: /^Inbox/ }).first()).toBeVisible()

    await page.goto('/settings?tab=general')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    for (const tab of ['General', 'Forwarding', 'Auto-reply', 'Canned responses', 'Other apps']) {
      await expect(page.getByRole('tab', { name: tab, exact: true })).toBeAttached()
    }

    // Français : appliqué immédiatement, sans rechargement de la page.
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true })
    await chooseLanguage(page, 'Français')
    await expect(page.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(page.getByRole('tab', { name: 'Général', exact: true })).toBeAttached()
    await expect(page.getByRole('tab', { name: 'Transfert', exact: true })).toBeAttached()
    await expect(page.getByText('Préférences enregistrées')).toBeVisible()
    await expect(page.getByLabel('Langue / Language')).toHaveText(/Français/)

    // Retour à l'anglais.
    await chooseLanguage(page, 'English')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('tab', { name: 'Auto-reply', exact: true })).toBeAttached()
    await expect(page.getByText('Preferences saved')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)

    // La préférence du compte est conservée : après rechargement, toujours en anglais.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByLabel('Langue / Language')).toHaveText(/English/)
  })

  test('i18n-3. préférence « Français » d\'un compte : gagne sur le navigateur anglais, y compris à la connexion suivante', async ({ page }) => {
    await page.goto('/login')
    await signIn(page)
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
    await page.goto('/settings?tab=general')
    await chooseLanguage(page, 'Français')
    await expect(page.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeVisible()

    // La page de connexion suit le dernier choix du compte (mémorisé dans ce navigateur).
    await page.goto('/mail/INBOX')
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouveau message', exact: true }).first()).toBeVisible()
    await page.context().clearCookies()
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  })

  test('i18n-4. sélecteur FR | EN de la page de connexion, mémorisé par le navigateur', async ({ page }) => {
    await page.goto('/login')
    const switcher = page.getByRole('group', { name: 'Interface language' })
    await expect(switcher.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await switcher.getByRole('button', { name: 'Français' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    const fr = page.getByRole('group', { name: 'Langue de l’interface' })
    await expect(fr.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true')
    // Cible tactile d'au moins 44 px.
    const box = await fr.getByRole('button', { name: 'English' }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()

    // Erreur du serveur dans la langue choisie, même avec un navigateur anglais.
    await page.getByLabel('Adresse e-mail').fill(DEV.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill('mauvais')
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Adresse ou mot de passe incorrect.' })).toBeVisible()

    await fr.getByRole('button', { name: 'English' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  })
})

test.describe('choix à la connexion (compte « auto ») : navigateur français par défaut', () => {
  test.use({ locale: 'fr-FR' })

  test('i18n-5. choix EN à la connexion : suit après connexion, survit au rechargement, visible dans Paramètres', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()
    const switcher = page.getByRole('group', { name: 'Langue de l’interface' })
    await switcher.getByRole('button', { name: 'English' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    // Choix appliqué avant même la connexion (préférence du compte encore inconnue).
    await signIn(page)
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Inbox' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'New message', exact: true }).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    // Recopié comme préférence du compte : un rechargement (nouvelle session côté client,
    // application SPA) reste en anglais sans dépendre uniquement du localStorage.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Inbox' }).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await page.goto('/settings?tab=general')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByLabel('Langue / Language')).toHaveText(/English/)
  })

  test('i18n-6. préférence de compte déjà English : gagne même si ce navigateur mémorise Français', async ({ page }) => {
    await page.goto('/login')
    await signInFr(page)
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()

    await page.goto('/settings?tab=general')
    await chooseLanguage(page, 'English')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()

    // Le compte a déjà une préférence explicite : un localStorage périmé (autre appareil,
    // autre session) ne doit jamais la remplacer.
    await page.evaluate(() => window.localStorage.setItem('colombe.lang', 'fr'))
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByLabel('Langue / Language')).toHaveText(/English/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    // Et ce navigateur se remet à jour (jamais l'inverse).
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('colombe.lang'))).toBe('en')
  })
})

test.describe('choix à la connexion (compte « auto ») : navigateur anglais', () => {
  test.use({ locale: 'en-US' })

  test('i18n-7. choix FR à la connexion : l\'application est en français après connexion', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    const switcher = page.getByRole('group', { name: 'Interface language' })
    await switcher.getByRole('button', { name: 'Français' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()

    await signInFr(page)
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Boîte de réception' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouveau message', exact: true }).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  })
})
