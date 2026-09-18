/**
 * Parcours utilisateur de bout en bout, en boîte noire (sélecteurs accessibles uniquement).
 * Prérequis : l'application tourne avec MAIL_BACKEND=mock (pnpm dev).
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const DEV = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const ALICE = { email: 'alice@mmi-troyes.fr', password: 'alice-password' }
const NEWSLETTER = 'La lettre du département — septembre'
const TRAP = 'Facture impayée — action requise'
const GRADES = 'Relevé de notes — semestre 4'

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024

async function login(page: Page, who = DEV) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/mail\/INBOX/)
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
}

async function logout(page: Page, who = DEV) {
  await page.getByRole('button', { name: `Compte ${who.email}` }).click()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/login/)
}

async function openFolder(page: Page, name: string) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByRole('navigation', { name: 'Dossiers' }).getByRole('link', { name: new RegExp(`^${name}`) }).first().click()
  await expect(page.getByRole('list', { name: 'Messages' }).or(page.getByText('Aucun message dans ce dossier.'))).toBeVisible()
}

const messages = (page: Page) => page.getByRole('list', { name: 'Messages' })
const messageLink = (page: Page, subject: string) => messages(page).getByRole('link', { name: new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })

async function openCompose(page: Page) {
  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: /Nouveau message/ })).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/__mock/reset', { headers: { origin: 'http://localhost:3000' } })
  expect(res.status()).toBe(204)
})

test('1. une erreur de mot de passe reste sur /login avec un message clair', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(DEV.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill('mauvais')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('Adresse ou mot de passe incorrect.')
  await expect(page).toHaveURL(/\/login/)
})

test('2. la connexion mène à la boîte de réception et les redirections protègent les pages', async ({ page }) => {
  await page.goto('/mail/INBOX')
  await expect(page).toHaveURL(/\/login/)
  await login(page)
  await expect(messageLink(page, NEWSLETTER)).toBeVisible()
  await page.goto('/login')
  await expect(page).toHaveURL(/\/mail\/INBOX/)
})

test('3. les images distantes sont bloquées jusqu’au clic', async ({ page }) => {
  await login(page)
  await messageLink(page, NEWSLETTER).click()
  await expect(page.getByRole('heading', { name: NEWSLETTER })).toBeVisible()
  await expect(page.getByText('Les images distantes sont masquées pour protéger votre vie privée.')).toBeVisible()
  await page.getByRole('button', { name: 'Afficher les images' }).click()
  await expect(page.getByText('Les images distantes sont masquées pour protéger votre vie privée.')).toBeHidden()
})

test('4. un e-mail piégé ne peut exécuter aucun script', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await login(page)
  await messageLink(page, TRAP).click()
  const frame = page.getByTitle('Contenu du message')
  await expect(frame).toBeVisible()
  const sandbox = (await frame.getAttribute('sandbox')) ?? ''
  expect(sandbox).not.toContain('allow-scripts')
  expect(sandbox).not.toContain('allow-same-origin')
  await expect(page.frameLocator('iframe[title="Contenu du message"]').getByText('Votre compte sera suspendu.')).toBeVisible()
  expect(dialogs).toEqual([])
})

test('5. une pièce jointe se télécharge', async ({ page }) => {
  await login(page)
  await messageLink(page, GRADES).click()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: /releve-notes-S4\.pdf/ }).click()
  expect((await download).suggestedFilename()).toBe('releve-notes-S4.pdf')
})

test('6. écrire et envoyer : le message arrive chez le destinataire', async ({ page }) => {
  const subject = `E2E envoi ${Date.now()}`
  await login(page)
  await openCompose(page)
  await page.getByLabel('À', { exact: true }).fill(ALICE.email)
  await page.getByLabel('À', { exact: true }).press('Enter')
  await page.getByLabel('Objet').fill(subject)
  await page.getByLabel('Message', { exact: true }).fill('Bonjour Alice, message de test.')
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await expect(page.getByText('Message envoyé')).toBeVisible()

  await openFolder(page, 'Envoyés')
  await expect(messageLink(page, subject)).toBeVisible()

  await logout(page)
  await login(page, ALICE)
  const row = messageLink(page, subject)
  await expect(row).toBeVisible()
  await expect(row.locator('span.font-bold').first()).toBeVisible() // non lu = gras
})

test('7. répondre préremplit le destinataire et l’objet', async ({ page }) => {
  await login(page)
  await messageLink(page, GRADES).click()
  await page.getByRole('button', { name: 'Répondre', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Retirer scolarite@mmi-troyes.fr' })).toBeVisible()
  await expect(dialog.getByLabel('Objet')).toHaveValue(`Re: ${GRADES}`)
})

test('8. la recherche filtre la liste et s’efface', async ({ page }) => {
  await login(page)
  const search = page.getByRole('searchbox', { name: 'Rechercher dans les messages' })
  await search.fill('relevé de notes')
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: 'Résultats pour « relevé de notes »' })).toBeAttached()
  await expect(messages(page).getByRole('listitem')).toHaveCount(1)
  await expect(messageLink(page, GRADES)).toBeVisible()
  await page.getByRole('link', { name: 'Effacer' }).click()
  await expect(messageLink(page, NEWSLETTER)).toBeVisible()
})

test('9. supprimer envoie le message dans la corbeille', async ({ page }) => {
  await login(page)
  const select = isMobile(page)
    ? page.getByRole('button', { name: `Sélectionner « ${NEWSLETTER} »` })
    : page.getByRole('checkbox', { name: `Sélectionner « ${NEWSLETTER} »` })
  await select.click()
  await page.getByRole('toolbar', { name: 'Actions sur les messages' }).getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(messageLink(page, NEWSLETTER)).toBeHidden()
  await openFolder(page, 'Corbeille')
  await expect(messageLink(page, NEWSLETTER)).toBeVisible()
})

test('10. l’étoile persiste après rechargement', async ({ page }) => {
  await login(page)
  const row = () => messages(page).getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(NEWSLETTER) }) })
  await row().getByRole('button', { name: 'Ajouter une étoile' }).filter({ visible: true }).click()
  await expect(row().getByRole('button', { name: 'Retirer l’étoile' }).filter({ visible: true })).toBeVisible()
  await page.reload()
  await expect(row().getByRole('button', { name: 'Retirer l’étoile' }).filter({ visible: true })).toBeVisible()
})

test('11. un brouillon est enregistré automatiquement', async ({ page }) => {
  await login(page)
  await openCompose(page)
  await page.getByLabel('Objet').fill('Brouillon e2e')
  await expect(page.getByRole('status').filter({ hasText: 'Brouillon enregistré' })).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Enregistrer et fermer' }).click()
  await openFolder(page, 'Brouillons')
  await expect(messageLink(page, 'Brouillon e2e')).toBeVisible()
})

test('12. raccourcis clavier c et /', async ({ page }) => {
  test.skip(isMobile(page), 'raccourcis clavier : bureau uniquement')
  await login(page)
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox', { name: 'Rechercher dans les messages' })).toBeFocused()
  await page.getByRole('searchbox', { name: 'Rechercher dans les messages' }).blur()
  await page.keyboard.press('c')
  await expect(page.getByRole('dialog', { name: /Nouveau message/ })).toBeVisible()
})

test('13. aucun défilement horizontal à 320 px', async ({ page }) => {
  test.skip(!isMobile(page), 'mise en page mobile uniquement')
  await login(page)
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  expect(await noOverflow()).toBe(true)
  await messageLink(page, 'Un sujet très long').click()
  await expect(page.getByTitle('Contenu du message')).toBeVisible()
  expect(await noOverflow()).toBe(true)
})
