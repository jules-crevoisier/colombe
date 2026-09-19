/**
 * Paramètres → Autres applications (configuration IMAP/SMTP à distribuer aux utilisateurs),
 * en boîte noire. Les scénarios qui dépendent d'un nom public (MAIL_PUBLIC_HOST) sont
 * pilotés par des variables d'environnement lues au chargement de ce fichier :
 *
 *   E2E_PUBLIC_HOST  doit correspondre au MAIL_PUBLIC_HOST donné au serveur testé.
 *   E2E_ORG_NAME     doit correspondre au COLOMBE_ORG_NAME donné au serveur testé.
 *
 * Quand elles sont absentes (lancement standard, sans MAIL_PUBLIC_HOST), les tests qui
 * vérifient des valeurs précises sont ignorés (`test.skip`) et un test d'état vide tourne
 * à la place ; quand elles sont présentes, c'est l'inverse.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetMock } from '../support/reset'

const DEV = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024

const PUBLIC_HOST = process.env.E2E_PUBLIC_HOST
const ORG_NAME = process.env.E2E_ORG_NAME
const hasPublicHost = !!PUBLIC_HOST
const hasOrgName = !!ORG_NAME

async function login(page: Page, who = DEV) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

async function loginToInbox(page: Page, who = DEV) {
  await login(page, who)
  await expect(page).toHaveURL(/\/mail\/INBOX/)
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
}

/** Atteint Paramètres → Autres applications en passant par l'IHM (menu du compte, puis onglet). */
async function openAutresApplications(page: Page) {
  await page.getByRole('button', { name: `Compte ${DEV.email}` }).click()
  await page.getByRole('menuitem', { name: 'Paramètres' }).click()
  await expect(page).toHaveURL(/\/settings/)
  const tablist = page.getByRole('tablist', { name: 'Sections des paramètres' })
  await tablist.getByRole('tab', { name: 'Autres applications' }).click()
  await expect(page.getByRole('heading', { name: 'Autres applications' })).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  await resetMock(request)
})

test.describe('page de connexion', () => {
  test("1. le nom de l'établissement s'affiche quand il est configuré", async ({ page }) => {
    test.skip(!hasOrgName, 'COLOMBE_ORG_NAME non configuré pour ce run')
    await page.goto('/login')
    await expect(page.getByText(`Messagerie ${ORG_NAME}`)).toBeVisible()
  })

  test('2. « Mot de passe oublié ? » ouvre le lien de réinitialisation dans un nouvel onglet', async ({ page }) => {
    test.skip(!hasOrgName, 'COLOMBE_PASSWORD_RESET_URL vient avec COLOMBE_ORG_NAME dans ce run')
    await page.goto('/login')
    const link = page.getByRole('link', { name: 'Mot de passe oublié ?' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    const rel = await link.getAttribute('rel')
    expect(rel).toContain('noopener')
  })

  test("3. se connecter avec seulement l'identifiant (sans domaine) mène à la boîte de réception", async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Adresse e-mail').fill('dev')
    await page.getByLabel('Mot de passe', { exact: true }).fill(DEV.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/mail\/INBOX/)
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
  })

  test('4. une adresse étrangère au domaine est refusée avec un message explicite', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Adresse e-mail').fill('dev@gmail.com')
    await page.getByLabel('Mot de passe', { exact: true }).fill('peu importe')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert')).toContainText('@mmi-troyes.fr')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Paramètres → Autres applications', () => {
  test('5. les réglages de connexion affichent le serveur, les ports et les sécurités publics', async ({ page }) => {
    test.skip(!hasPublicHost, 'MAIL_PUBLIC_HOST non configuré pour ce run : voir le test « état vide »')
    await loginToInbox(page)
    await openAutresApplications(page)

    const imap = page.getByRole('region', { name: 'Réception IMAP' })
    await expect(imap.getByText(PUBLIC_HOST!)).toBeVisible()
    await expect(imap.getByText('993', { exact: true })).toBeVisible()
    await expect(imap.getByText('SSL/TLS', { exact: true })).toBeVisible()
    await expect(imap.getByText(DEV.email, { exact: true })).toBeVisible()

    const smtp = page.getByRole('region', { name: 'Envoi SMTP' })
    await expect(smtp.getByText(PUBLIC_HOST!)).toBeVisible()
    await expect(smtp.getByText('587', { exact: true })).toBeVisible()
    await expect(smtp.getByText('STARTTLS', { exact: true })).toBeVisible()
    await expect(smtp.getByText(DEV.email, { exact: true })).toBeVisible()
  })

  test('6. copier le serveur écrit dans le presse-papiers et confirme « Copié »', async ({ page, context, browserName }) => {
    test.skip(!hasPublicHost, 'MAIL_PUBLIC_HOST non configuré pour ce run')
    test.skip(browserName !== 'chromium', 'Permissions presse-papiers : Chromium uniquement')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await loginToInbox(page)
    await openAutresApplications(page)

    await page.getByRole('button', { name: 'Copier le serveur de réception' }).click()
    await expect(page.getByText('Copié')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(PUBLIC_HOST)
  })

  test("7. le sélecteur d'application propose Gmail, iPhone / iPad, Outlook, Thunderbird, Autre application", async ({ page }) => {
    test.skip(!hasPublicHost, 'MAIL_PUBLIC_HOST non configuré pour ce run')
    await loginToInbox(page)
    await openAutresApplications(page)

    const picker = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Gmail' }) })
    for (const name of ['Gmail', 'iPhone / iPad', 'Outlook', 'Thunderbird', 'Autre application']) {
      await expect(picker.getByRole('tab', { name })).toBeVisible()
    }

    // Gmail est l'onglet par défaut.
    await expect(page.getByRole('heading', { name: "Dans l'application Gmail (Android ou iPhone)" })).toBeVisible()
    await picker.getByRole('tab', { name: 'Outlook' }).click()
    await expect(page.getByText('Outlook pour Windows, Mac, Android ou iPhone.')).toBeVisible()
  })

  test("8. le panneau Gmail explique l'arrêt de la relève sur ordinateur et le transfert restreint", async ({ page }) => {
    test.skip(!hasPublicHost, 'MAIL_PUBLIC_HOST non configuré pour ce run')
    await loginToInbox(page)
    await openAutresApplications(page)

    const picker = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Gmail' }) })
    await picker.getByRole('tab', { name: 'Gmail' }).click()

    await expect(page.getByRole('heading', { name: 'Et Gmail sur ordinateur ?' })).toBeVisible()
    const gmailPanel = page.getByRole('tabpanel').filter({ hasText: 'Et Gmail sur ordinateur' })
    await expect(gmailPanel.getByText(/ne peut plus relever le courrier/)).toBeVisible()
    await expect(gmailPanel.getByText(/l'autorise pas vers Gmail/)).toBeVisible()
    await expect(gmailPanel.getByText('@mmi-troyes.fr', { exact: true })).toBeVisible()
  })

  test('9. le panneau iPhone / iPad propose le téléchargement du profil de configuration', async ({ page }) => {
    test.skip(!hasPublicHost, 'MAIL_PUBLIC_HOST non configuré pour ce run')
    await loginToInbox(page)
    await openAutresApplications(page)

    const picker = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Gmail' }) })
    await picker.getByRole('tab', { name: 'iPhone / iPad' }).click()

    const downloadLink = page.getByRole('link', { name: /profil de configuration/ })
    await expect(downloadLink).toBeVisible()
    const href = await downloadLink.getAttribute('href')
    expect(href).toBeTruthy()
    expect(href!.endsWith('apple.mobileconfig')).toBe(true)

    const response = await page.request.get(href!)
    expect(response.status()).toBe(200)
    const body = await response.text()
    expect(body).toContain(PUBLIC_HOST)
    expect(body).not.toContain(DEV.password)
  })

  test("10. état vide : le message indique que l'administrateur n'a pas encore publié les réglages", async ({ page }) => {
    test.skip(hasPublicHost, 'MAIL_PUBLIC_HOST configuré pour ce run : voir les tests de valeurs')
    await loginToInbox(page)
    await openAutresApplications(page)

    await expect(
      page.getByText("Votre administrateur n'a pas encore publié les paramètres pour les autres applications."),
    ).toBeVisible()
  })
})

test.describe('Paramètres → Transfert', () => {
  test('11. le champ de transfert rappelle les domaines autorisés', async ({ page }) => {
    await loginToInbox(page)
    await page.getByRole('button', { name: `Compte ${DEV.email}` }).click()
    await page.getByRole('menuitem', { name: 'Paramètres' }).click()
    await expect(page).toHaveURL(/\/settings/)
    const tablist = page.getByRole('tablist', { name: 'Sections des paramètres' })
    await tablist.getByRole('tab', { name: 'Transfert' }).click()
    await expect(page.getByRole('heading', { name: 'Transfert' })).toBeVisible()
    await expect(page.getByText('@mmi-troyes.fr')).toBeVisible()
  })
})

test('12. aucun défilement horizontal à 320 px sur Autres applications', async ({ page }) => {
  test.skip(!isMobile(page), 'mise en page mobile uniquement')
  await loginToInbox(page)
  await openAutresApplications(page)
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(await noOverflow()).toBe(true)
})
