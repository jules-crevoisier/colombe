/**
 * Interface en anglais (navigateur en-US) et choix de la langue, en boîte noire :
 * page de connexion, erreur du serveur traduite, Paramètres → Général → Langue,
 * <html lang>, libellés principaux et toasts. Mobile 320 px et bureau 1440 px.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetMock } from '../support/reset'

const DEV = { email: 'dev@universite.example', password: 'dev-password' }
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024

test.use({ locale: 'en-US' })

test.beforeEach(async ({ request }) => {
  await resetMock(request)
})

async function signIn(page: Page, password = DEV.password) {
  await page.getByLabel('Email address').fill(DEV.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function chooseLanguage(page: Page, option: 'Automatic (browser language)' | 'Automatique (langue du navigateur)' | 'Français' | 'English') {
  await page.getByLabel('Langue / Language').click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

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
