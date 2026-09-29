/**
 * Sélection multiple à la souris : Maj + clic (plage) et Ctrl + clic (un seul message).
 * Bureau uniquement : sur mobile l'avatar sert de case à cocher, sans clavier.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const DEV = { email: 'dev@universite.example', password: 'dev-password' }

async function loginToInbox(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(DEV.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(DEV.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  const welcome = page.getByRole('dialog', { name: 'Bienvenue' })
  const messageList = page.getByRole('list', { name: 'Messages' })
  await expect(welcome.or(messageList)).toBeVisible()
  await welcome.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await welcome.isVisible()) {
    await welcome.getByLabel('Nom affiché').fill(DEV.email.split('@')[0]!)
    await welcome.getByRole('button', { name: 'Continuer' }).click()
  }
  await expect(messageList).toBeVisible()
}

test.describe('Sélection multiple (Maj / Ctrl + clic)', () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const res = await request.post('/api/__mock/reset', { headers: { origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin } })
    expect(res.status()).toBe(204)
    test.skip(testInfo.project.name.startsWith('mobile'), 'Bureau uniquement')
  })

  test('Maj + clic sélectionne la plage vers le bas puis vers le haut, sans sélection de texte', async ({ page }) => {
    await loginToInbox(page)
    const rows = page.getByRole('list', { name: 'Messages' }).locator('li[data-uid]')
    expect(await rows.count()).toBeGreaterThanOrEqual(5)
    const box = (i: number) => rows.nth(i).getByRole('checkbox')

    await box(1).click()
    await box(3).click({ modifiers: ['Shift'] })
    for (const i of [1, 2, 3]) await expect(box(i)).toBeChecked()
    await expect(box(0)).not.toBeChecked()
    await expect(box(4)).not.toBeChecked()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

    // Vers le haut : le dernier coché (3) est le point de départ.
    await box(0).click({ modifiers: ['Shift'] })
    for (const i of [0, 1, 2, 3]) await expect(box(i)).toBeChecked()
    await expect(box(4)).not.toBeChecked()
  })

  test('Ctrl + clic sur la ligne ajoute ou retire un message sans l’ouvrir', async ({ page }) => {
    await loginToInbox(page)
    const rows = page.getByRole('list', { name: 'Messages' }).locator('li[data-uid]')
    await rows.nth(0).getByRole('link').click({ modifiers: ['Control'], position: { x: 40, y: 10 } })
    await expect(page).toHaveURL(/\/mail\/INBOX\/?$/)
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()
    await rows.nth(2).getByRole('link').click({ modifiers: ['Control'], position: { x: 40, y: 10 } })
    await expect(rows.nth(2).getByRole('checkbox')).toBeChecked()
    await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked()
    await rows.nth(0).getByRole('link').click({ modifiers: ['Control'], position: { x: 40, y: 10 } })
    await expect(rows.nth(0).getByRole('checkbox')).not.toBeChecked()
  })

  test('la sélection est vidée au changement de dossier', async ({ page }) => {
    await loginToInbox(page)
    const rows = page.getByRole('list', { name: 'Messages' }).locator('li[data-uid]')
    await rows.nth(0).getByRole('checkbox').click()
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()
    await page.goto('/mail/Sent')
    await page.goto('/mail/INBOX')
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('checkbox', { checked: true })).toHaveCount(0)
  })
})
