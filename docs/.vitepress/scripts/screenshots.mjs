/**
 * Captures d'écran du site : se connecte à une instance Colombe en marche et écrit les
 * images utilisées par la page d'accueil dans docs/public/screenshots/.
 *
 *   SHOT_BASE_URL=http://localhost:3215 SHOT_USER=… SHOT_PASSWORD=… node docs/.vitepress/scripts/screenshots.mjs
 *
 * Utiliser « localhost » et non 127.0.0.1 : le cookie de session est `Secure`, que
 * Chromium n'accepte en HTTP que pour localhost.
 *
 * Instance de démonstration conseillée : build de production avec MAIL_BACKEND=mock
 * (voir docs/admin/demo), démarrée avec MAIL_PUBLIC_HOST=mail.universite.example : sans
 * lui, l'onglet « Autres applications » n'a rien à afficher. Les images sont en PNG, à 1x
 * pour le bureau (1440 × 900) et à 2x pour le mobile (390 × 844).
 */
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../public/screenshots')

const baseUrl = (process.env.SHOT_BASE_URL || 'http://localhost:3215').replace(/\/+$/, '')
const user = process.env.SHOT_USER || 'dev@universite.example'
const password = process.env.SHOT_PASSWORD || 'dev-password'

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

/** Masque ce qui bouge (curseur, animations, notifications) pour des images stables. */
const STILL_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important;
    transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }
  [data-sonner-toaster] { display: none !important; }
`

async function newPage(browser, { viewport, scale, scheme }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    colorScheme: scheme,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 768,
  })
  // Thème de l'application (useColorMode, clé « wm-color-mode ») aligné sur la capture.
  await context.addInitScript((mode) => {
    try { localStorage.setItem('wm-color-mode', mode) }
    catch { /* stockage indisponible : le thème suit alors prefers-color-scheme */ }
  }, scheme)
  const page = await context.newPage()
  return { context, page }
}

async function settle(page) {
  await page.addStyleTag({ content: STILL_CSS })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
  await page.locator('#email').fill(user)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/\/mail\//, { timeout: 20_000 })
  await dismissWelcome(page)
  await page.locator('li[data-uid]').first().waitFor({ timeout: 20_000 })
}

/** Première connexion : la boîte « Bienvenue » demande le nom affiché. */
async function dismissWelcome(page) {
  const dialog = page.getByRole('dialog', { name: 'Bienvenue' })
  try {
    await dialog.waitFor({ state: 'visible', timeout: 3_000 })
  }
  catch {
    return
  }
  const name = dialog.getByLabel('Nom affiché')
  if (!(await name.inputValue()).trim()) await name.fill('Camille Martin')
  await dialog.getByRole('button', { name: 'Continuer' }).click()
  await dialog.waitFor({ state: 'hidden' })
}

/** Ouvre le message dont l'objet contient `subject`, sinon le premier de la liste. */
async function openMessage(page, subject) {
  const row = page.locator('li[data-uid]', { hasText: subject })
  const target = (await row.count()) > 0 ? row.first() : page.locator('li[data-uid]').first()
  await target.locator('a').first().click()
}

async function shot(page, file) {
  await settle(page)
  await page.screenshot({ path: resolve(outDir, file), fullPage: false })
  console.log(`  ${file}`)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  console.log(`Colombe : ${baseUrl} (compte ${user})`)
  const browser = await chromium.launch()
  try {
    // Bureau, clair : boîte de réception, message ouvert, rédaction, réglages.
    {
      const { context, page } = await newPage(browser, { viewport: DESKTOP, scale: 1, scheme: 'light' })
      await login(page)
      await shot(page, 'inbox-light.png')

      await openMessage(page, 'La lettre du département')
      await page.waitForURL(/\/mail\/[^/]+\/\d+/)
      await page.locator('iframe').first().waitFor({ timeout: 10_000 }).catch(() => {})
      await shot(page, 'message.png')

      await page.goto(`${baseUrl}/mail/INBOX`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Nouveau message' }).first().click()
      const compose = page.getByRole('dialog').filter({ has: page.locator('#compose-title') })
      await compose.waitFor()
      await compose.getByLabel('Objet').fill('Réunion de rentrée').catch(() => {})
      await compose.getByLabel('Message').click()
      await page.keyboard.type('Bonjour à tous,\n\nLa réunion de rentrée aura lieu jeudi à 10 h en salle 204. Merci de confirmer votre présence.\n\nBonne journée,')
      await shot(page, 'compose.png')

      await page.goto(`${baseUrl}/settings?tab=devices`, { waitUntil: 'networkidle' })
      await shot(page, 'settings-apps.png')

      await page.goto(`${baseUrl}/settings?tab=filters`, { waitUntil: 'networkidle' })
      const newFilter = page.getByRole('button', { name: 'Nouveau filtre' })
      if (await newFilter.isVisible().catch(() => false)) {
        await newFilter.click()
        const editor = page.getByRole('dialog', { name: 'Nouveau filtre' })
        await editor.waitFor()
        await editor.getByLabel('Objet', { exact: true }).fill('Relevé de notes').catch(() => {})
        await editor.getByLabel('Suivre', { exact: true }).check().catch(() => {})
        await page.locator(':focus').blur().catch(() => {})
        // Remonter en haut du formulaire : l'image montre les critères et les actions.
        await editor.evaluate((root) => {
          for (const el of [root, ...root.querySelectorAll('*')]) if (el.scrollTop > 0) el.scrollTop = 0
        })
      }
      await shot(page, 'filters.png')
      await context.close()
    }

    // Bureau, sombre.
    {
      const { context, page } = await newPage(browser, { viewport: DESKTOP, scale: 1, scheme: 'dark' })
      await login(page)
      await shot(page, 'inbox-dark.png')
      await context.close()
    }

    // Mobile 390 px, clair et sombre.
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(browser, { viewport: MOBILE, scale: 2, scheme })
      await login(page)
      await shot(page, scheme === 'light' ? 'inbox-mobile.png' : 'inbox-mobile-dark.png')
      await context.close()
    }
  }
  finally {
    await browser.close()
  }
  console.log(`Images écrites dans ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
