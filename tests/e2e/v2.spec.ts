/**
 * Parcours v2 (fonctionnalités avancées), en boîte noire. Bureau uniquement
 * pour les gestes souris (glisser-déposer) ; le reste tourne aussi en mobile.
 */
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { totpAt } from '../../server/lib/auth/totp'

const DEV = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const ALICE = { email: 'alice@mmi-troyes.fr', password: 'alice-password' }
const GRADES = 'Relevé de notes — semestre 4'
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function login(page: Page, who = DEV) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

async function loginToInbox(page: Page, who = DEV) {
  await login(page, who)
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
}

const messages = (page: Page) => page.getByRole('list', { name: 'Messages' })
const messageLink = (page: Page, subject: string) => messages(page).getByRole('link', { name: new RegExp(escape(subject)) })

async function compose(page: Page, to: string, subject: string, body: string) {
  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()
  // Le nom accessible de la fenêtre suit l'objet : on la retient sans filtrer sur le nom.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Nouveau message')
  await dialog.getByLabel('À', { exact: true }).fill(to)
  await dialog.getByLabel('À', { exact: true }).press('Enter')
  await dialog.getByLabel('Objet').fill(subject)
  await dialog.getByRole('textbox', { name: 'Message' }).click()
  await page.keyboard.type(body)
  return dialog
}

/** Envoie un message de alice vers dev via l'API, depuis un contexte séparé. */
async function aliceSends(browser: Browser, subject: string) {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const req = ctx.request
  const headers = { origin: 'http://localhost:3000' }
  expect((await req.post('/api/auth/login', { data: ALICE, headers })).status()).toBe(200)
  expect((await req.post('/api/send', { data: { to: [DEV.email], cc: [], bcc: [], subject, text: 'Coucou' }, headers })).status()).toBe(204)
  await ctx.close()
}

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/__mock/reset', { headers: { origin: 'http://localhost:3000' } })
  expect(res.status()).toBe(204)
})

test('v2-1. double authentification : activation puis connexion avec code', async ({ page }) => {
  await loginToInbox(page)
  await page.goto('/settings?tab=security')
  await page.getByRole('button', { name: 'Activer la double authentification' }).click()
  const secretText = await page.locator('code').filter({ hasText: /^[A-Z2-7 ]+$/ }).first().innerText()
  const secret = secretText.replace(/\s/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible()
  await page.getByLabel(/code/i).first().fill(totpAt(secret, Math.floor(Date.now() / 1000)))
  await page.getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('Codes de secours', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /J'ai enregistré mes codes/ }).click()
  await expect(page.getByText(/Activée/)).toBeVisible()

  await page.getByRole('button', { name: `Compte ${DEV.email}` }).click()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
  await login(page)
  await expect(page.getByRole('heading', { name: 'Validation en deux étapes' })).toBeVisible()
  await page.getByLabel('Code de vérification').fill('000000')
  await page.getByRole('button', { name: 'Valider' }).click()
  await expect(page.getByRole('alert')).toContainText('Code incorrect')
  await page.getByLabel('Code de vérification').fill(totpAt(secret, Math.floor(Date.now() / 1000) + 30))
  await page.getByRole('button', { name: 'Valider' }).click()
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
})

test('v2-2. éditeur riche : le gras arrive chez le destinataire, sans script', async ({ page }) => {
  const subject = `Riche ${Date.now()}`
  await loginToInbox(page)
  const dialog = await compose(page, ALICE.email, subject, 'Texte ')
  await dialog.getByRole('button', { name: 'Gras (Ctrl+B)' }).click()
  await page.keyboard.type('important')
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await page.getByRole('button', { name: 'Annuler' }).waitFor({ state: 'visible' })
  await expect(page.getByText('Message envoyé')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: `Compte ${DEV.email}` }).click()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
  await loginToInbox(page, ALICE)
  await messageLink(page, subject).click()
  const body = page.frameLocator('iframe[title="Contenu du message"]')
  await expect(body.locator('strong', { hasText: 'important' })).toBeVisible()
})

test('v2-3. annuler l’envoi rouvre le message intact', async ({ page }) => {
  await loginToInbox(page)
  const dialog = await compose(page, ALICE.email, 'À annuler', 'Brouillon à ne pas envoyer')
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await page.getByRole('button', { name: 'Annuler' }).click()
  const reopened = page.getByRole('dialog', { name: /À annuler/ })
  await expect(reopened).toBeVisible()
  await expect(reopened.getByRole('textbox', { name: 'Message' })).toContainText('Brouillon à ne pas envoyer')
})

test('v2-4. autocomplétion des contacts déjà écrits', async ({ page }) => {
  await loginToInbox(page)
  const dialog = await compose(page, ALICE.email, `Contact ${Date.now()}`, 'x')
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await expect(page.getByText('Message envoyé')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()
  const next = page.getByRole('dialog')
  await next.getByRole('combobox', { name: 'À' }).fill('ali')
  await expect(next.getByRole('option', { name: /alice@mmi-troyes\.fr/ })).toBeVisible()
  await next.getByRole('combobox', { name: 'À' }).press('Enter')
  await expect(next.getByRole('button', { name: `Retirer ${ALICE.email}` })).toBeVisible()
})

test('v2-5. créer un dossier et y glisser un message', async ({ page }) => {
  test.skip(isMobile(page), 'glisser-déposer : bureau uniquement')
  await loginToInbox(page)
  await page.getByRole('button', { name: 'Nouveau dossier' }).first().click()
  await page.getByLabel('Nom du dossier').fill('Projet E2E')
  await page.getByRole('button', { name: 'Créer' }).click()
  const nav = page.getByRole('navigation', { name: 'Dossiers' }).first()
  const target = nav.getByRole('link', { name: /^Projet E2E/ })
  await expect(target).toBeVisible()

  const row = messages(page).getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(escape(GRADES)) }) })
  await row.dragTo(target)
  await expect(page.getByText(/déplacé vers « Projet E2E »/)).toBeVisible()
  await expect(messageLink(page, GRADES)).toBeHidden()
  await target.click()
  await expect(messageLink(page, GRADES)).toBeVisible()
})

test('v2-6. vue conversation après une réponse', async ({ page }) => {
  await loginToInbox(page)
  await messageLink(page, GRADES).click()
  await page.getByRole('button', { name: 'Répondre', exact: true }).click()
  await page.keyboard.type('Merci pour le relevé.')
  await page.getByRole('dialog').getByRole('button', { name: 'Envoyer', exact: true }).click()
  await expect(page.getByText('Message envoyé')).toBeVisible({ timeout: 15_000 })
  await page.reload()
  await expect(page.getByText('2 messages dans cette conversation')).toBeVisible()
})

test('v2-7. un nouveau message apparaît sans recharger la page', async ({ page, browser }) => {
  await loginToInbox(page)
  const subject = `En direct ${Date.now()}`
  await aliceSends(browser, subject)
  await expect(messageLink(page, subject)).toBeVisible({ timeout: 10_000 })
})

test('v2-8. aide des raccourcis clavier', async ({ page }) => {
  test.skip(isMobile(page), 'clavier : bureau uniquement')
  await loginToInbox(page)
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible()
})
