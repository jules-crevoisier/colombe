import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetMock } from '../support/reset'

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
    test(`v2 a11y ${scheme} ${width}px : paramètres, éditeur riche, dossiers`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await login(page)

      for (const tab of ['general', 'signature', 'security', 'contacts']) {
        await page.goto(`/settings?tab=${tab}`)
        await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        await scan(page, `settings/${tab}`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      }

      await page.goto('/mail/INBOX')
      await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await scan(page, 'compose')

      await page.keyboard.press('Escape')
      if (width >= 1024) {
        await page.getByRole('button', { name: 'Nouveau dossier' }).first().click()
        await expect(page.getByLabel('Nom du dossier')).toBeVisible()
        await scan(page, 'folder-dialog')
      }
    })
  }
}
