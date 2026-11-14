import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetMock } from '../support/reset'

/**
 * Onglet « État du serveur » (administrateurs). Demande un serveur lancé avec
 * COLOMBE_ADMIN_EMAILS=dev@universite.example et COLOMBE_SERVER_STATUS_FILE
 * pointant sur tests/fixtures/etat-serveur.json ; sinon le test est ignoré.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function login(page: Page) {
  await resetMock(page.request)
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill('dev@universite.example')
  await page.getByLabel('Mot de passe', { exact: true }).fill('dev-password')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
}

async function scan(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const summary = violations.map(v => `${label} › ${v.impact} ${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)
  expect(summary).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`état du serveur a11y ${scheme} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await login(page)

      const access = await (await page.request.get('/api/admin/access')).json() as { serverStatus: boolean }
      test.skip(!access.serverStatus, 'Serveur lancé sans COLOMBE_ADMIN_EMAILS / COLOMBE_SERVER_STATUS_FILE.')

      await page.goto('/settings?tab=status')
      await expect(page.getByRole('heading', { name: 'État du serveur', level: 2 })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Actualiser' })).toBeEnabled()
      await page.waitForLoadState('networkidle')
      await scan(page, 'settings/status')

      // Tableau horaire déplié : il doit rester lisible et sans défilement horizontal de page.
      await page.getByText('Voir le tableau').first().click()
      await expect(page.getByRole('table').first()).toBeVisible()
      await scan(page, 'settings/status (tableau)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    })
  }
}
