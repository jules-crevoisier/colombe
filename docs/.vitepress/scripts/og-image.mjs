/**
 * Image de partage du site (docs/public/og.png, 1200 × 630), dessinée en HTML avec les
 * polices auto-hébergées puis photographiée par Playwright. Aucune ressource externe.
 *
 *   node docs/.vitepress/scripts/og-image.mjs
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const out = resolve(here, '../../public/og.png')

async function fontData(pkg, file) {
  const path = resolve(dirname(require.resolve(`${pkg}/package.json`)), 'files', file)
  return `data:font/woff2;base64,${(await readFile(path)).toString('base64')}`
}

const serif = await fontData('@fontsource-variable/newsreader', 'newsreader-latin-opsz-normal.woff2')
const serifItalic = await fontData('@fontsource-variable/newsreader', 'newsreader-latin-opsz-italic.woff2')
const sans = await fontData('@fontsource-variable/instrument-sans', 'instrument-sans-latin-wght-normal.woff2')
const logo = await readFile(resolve(here, '../../public/logo.svg'), 'utf8')

const dove = `
<svg viewBox="-46 0 112 52" fill="none" aria-hidden="true">
  <path d="M-42 46 C-26 50 -14 30 -4 36 S 2 44 8 39" stroke="#bdb4a1" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="2.2 3.6"/>
  <g stroke="#9fb6f0" stroke-width="0.5" stroke-linejoin="round">
    <polygon points="21,35 14,11 29,31" fill="#9fb6f0"/>
    <polygon points="21,35 27,7 38,30" fill="#ffffff"/>
    <polygon points="7,39 21,35 31,45" fill="#dbe5fb"/>
    <polygon points="21,35 38,30 31,45" fill="#eef3fd"/>
    <polygon points="31,45 38,30 47,31" fill="#c9d7f7"/>
    <polygon points="38,30 49,19 47,31" fill="#ffffff"/>
    <polygon points="49,19 57,22.5 47,31" fill="#dbe5fb"/>
    <polygon points="57,22.5 62,25 55.5,26" fill="#f59e6b" stroke="none"/>
  </g>
</svg>`

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Newsreader'; font-style: normal; font-weight: 200 800; src: url(${serif}) format('woff2'); }
  @font-face { font-family: 'Newsreader'; font-style: italic; font-weight: 200 800; src: url(${serifItalic}) format('woff2'); }
  @font-face { font-family: 'Instrument Sans'; font-weight: 400 700; src: url(${sans}) format('woff2'); }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #f4f1ea; color: #1a2233;
    font-family: 'Instrument Sans', sans-serif; position: relative; }
  .brand { position: absolute; top: 64px; left: 80px; display: flex; align-items: center; gap: 16px;
    font-family: 'Newsreader', serif; font-size: 40px; font-weight: 600; letter-spacing: -0.01em; }
  .brand svg { width: 52px; height: 52px; border-radius: 13px; }
  h1 { position: absolute; left: 80px; top: 196px; width: 700px; font-family: 'Newsreader', serif;
    font-weight: 450; font-size: 66px; line-height: 1.04; letter-spacing: -0.028em; }
  h1 em { font-style: italic; font-weight: 400; color: #b4541a; }
  .foot { position: absolute; left: 80px; bottom: 60px; display: flex; gap: 28px; font-size: 24px; color: #5a6070; }
  .foot span { display: inline-flex; align-items: center; gap: 12px; }
  .foot span::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #1f3a8a; }
  .dove { position: absolute; right: 40px; top: 150px; width: 470px; }
  .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #1f3a8a; }
</style></head><body>
  <div class="brand">${logo.replace(/<title>.*?<\/title>/, '')}<span>Colombe</span></div>
  <h1>Le webmail des établissements qui gardent leur courrier <em>chez&nbsp;eux</em>.</h1>
  <div class="dove">${dove}</div>
  <div class="foot"><span>Logiciel libre, AGPL-3.0</span><span>Auto-hébergé</span><span>Sécurisé par défaut</span></div>
  <div class="rule"></div>
</body></html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: out })
  console.log(`Image écrite : ${out}`)
}
finally {
  await browser.close()
}
