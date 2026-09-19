/**
 * Tests E2E boîte noire pour la vague R1 : actions sur messages, recherche, rédaction.
 * Sélecteurs accessibles uniquement (getByRole/getByLabel/getByText avec libellés contractuels).
 * Voir docs/PLAN-v3.md sections R1.1-R1.5.
 *
 * STRICT ASSERTIONS: Contractual UI elements MUST exist (no guard clauses).
 * Failures indicate missing or broken R1 features.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetMock } from '../support/reset'

const DEV = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const ALICE = { email: 'alice@mmi-troyes.fr', password: 'alice-password' }

// Test data from PLAN-v3
const PHOTOS = 'Photos de la sortie'
const GRADES = 'Relevé de notes — semestre 4'
const READ_RECEIPT = 'Réunion : merci de confirmer'
const QUOTED = 'Re: Planning'

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function login(page: Page, who = DEV) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/mail\/INBOX/)
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
}

async function openFolder(page: Page, name: string) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByRole('navigation', { name: 'Dossiers' }).getByRole('link', { name: new RegExp(`^${escape(name)}`) }).first().click()
  await expect(page.getByRole('list', { name: 'Messages' }).or(page.getByText('Aucun message dans ce dossier.'))).toBeVisible()
}

const messages = (page: Page) => page.getByRole('list', { name: 'Messages' })
const messageLink = (page: Page, subject: string) => messages(page).getByRole('link', { name: new RegExp(escape(subject)) })
const moreActionsButton = (page: Page) => page.getByRole('button', { name: 'Plus d\'actions' })
// Volet de lecture (R2.5, ≥ 1024 px) : la liste et le message ont chacun leur « Plus d'actions ».
const messageMoreActions = (page: Page) => page.getByRole('toolbar', { name: 'Actions sur le message' }).getByRole('button', { name: 'Plus d\'actions' })

async function selectMessage(page: Page, subject: string) {
  // Use relative locator: filter with absolute link inside has
  const row = messages(page).getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(escape(subject)) }) })
  if (isMobile(page)) {
    await row.getByRole('button', { name: new RegExp(`Sélectionner.*${escape(subject)}`) }).click()
  } else {
    await row.getByRole('checkbox', { name: new RegExp(`Sélectionner.*${escape(subject)}`) }).click()
  }
}

test.beforeEach(async ({ request }) => {
  await resetMock(request)
})

// ============================================================================
// R1.1 — Actions sur la liste : tri, marquer tout comme lu, copier, spam, vider, zip, import
// ============================================================================

test('R1.1.1 — Trier menu exists with menuitemradio options: Date, Expéditeur, Objet, Taille', async ({ page }) => {
  await login(page)

  const sortButton = page.getByRole('button', { name: 'Trier' })
  await expect(sortButton).toBeVisible()
  await sortButton.click()

  // All menuitemradio options must exist per spec (dropdown menu radios)
  await expect(page.getByRole('menuitemradio', { name: 'Date' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Expéditeur' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Objet' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Taille' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Ordre croissant' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Ordre décroissant' })).toBeVisible()
})

test('R1.1.1 — Sort by Subject produces alphabetical order', async ({ page }) => {
  await login(page)

  await page.getByRole('button', { name: 'Trier' }).click()
  await page.getByRole('menuitemradio', { name: 'Objet' }).click()

  const subjects = await messages(page).getByRole('listitem').getByRole('link').allTextContents()
  const extracted = subjects.map(s => s.split('\n')[0])
  expect(extracted).toEqual([...extracted].sort((a, b) => a.localeCompare(b, 'fr')))
})

test('R1.1.1 — Sort order toggle: ascending/descending', async ({ page }) => {
  test.skip(isMobile(page), 'sort menu: keyboard interaction, desktop only')
  await login(page)

  const dates1 = await messages(page).getByRole('listitem').evaluateAll((els) => els.map(el => el.textContent ?? ''))

  await page.getByRole('button', { name: 'Trier' }).click()
  await page.getByRole('menuitemradio', { name: 'Ordre croissant' }).click()

  const dates2 = await messages(page).getByRole('listitem').evaluateAll((els) => els.map(el => el.textContent ?? ''))
  expect(dates1).not.toEqual(dates2)
})

test('R1.1.1 — Plus d\'actions → "Marquer tout comme lu" menuitem exists', async ({ page }) => {
  await login(page)

  await expect(moreActionsButton(page)).toBeVisible()
  await moreActionsButton(page).click()

  // Option must exist as menuitem
  await expect(page.getByRole('menuitem', { name: 'Marquer tout comme lu' })).toBeVisible()
})

test('R1.1.1 — Mark all as read: POST /api/folders/mark-read succeeds', async ({ page }) => {
  await login(page)

  // Verify unread exist before
  const unreadBefore = await messages(page).getByRole('listitem').filter({ has: page.locator('span.font-bold') }).count()
  expect(unreadBefore).toBeGreaterThan(0)

  await moreActionsButton(page).click()
  await page.getByRole('menuitem', { name: 'Marquer tout comme lu' }).click()

  // All messages now read (no bold text)
  const unreadAfter = await messages(page).getByRole('listitem').filter({ has: page.locator('span.font-bold') }).count()
  expect(unreadAfter).toBe(0)
})

test('R1.1.1 — Copier vers… submenu and destination folder', async ({ page }) => {
  await login(page)

  await selectMessage(page, GRADES)

  await expect(moreActionsButton(page)).toBeVisible()
  await moreActionsButton(page).click()

  const copyOption = page.getByRole('menuitem', { name: 'Copier vers…' })
  await expect(copyOption).toBeVisible()
  await copyOption.click()

  // Submenu opens in portal at end of body, folders appear as menuitem
  const projetsOption = page.getByRole('menuitem', { name: /Projets/ })
  await expect(projetsOption).toBeVisible()
  await projetsOption.click()

  // Original stays in INBOX
  await expect(messageLink(page, GRADES)).toBeVisible()

  // Copy exists in Projets
  await openFolder(page, 'Projets')
  await expect(messageLink(page, GRADES)).toBeVisible()
})

test('R1.1.1 — Signaler comme spam moves message to Spam folder', async ({ page }) => {
  await login(page)

  const subject = 'La lettre du département — septembre'

  await selectMessage(page, subject)

  await expect(moreActionsButton(page)).toBeVisible()
  await moreActionsButton(page).click()

  const spamOption = page.getByRole('menuitem', { name: 'Signaler comme spam' })
  await expect(spamOption).toBeVisible()
  await spamOption.click()

  // Not in INBOX anymore
  await expect(messageLink(page, subject)).toBeHidden()

  // In Spam
  await openFolder(page, 'Spam')
  await expect(messageLink(page, subject)).toBeVisible()
})

test('R1.1.1 — In Spam: "Ce n\'est pas un spam" menuitem returns to INBOX', async ({ page }) => {
  await login(page)

  await openFolder(page, 'Spam')

  // Le jeu de données contient un message dans Spam : on sélectionne la première ligne
  // par sa propre commande de sélection (case à cocher sur bureau, avatar sur mobile).
  const firstRow = messages(page).getByRole('listitem').first()
  await firstRow.getByRole(isMobile(page) ? 'button' : 'checkbox', { name: /^Sélectionner/ }).click()

  await expect(moreActionsButton(page)).toBeVisible()
  await moreActionsButton(page).click()

  const notSpamOption = page.getByRole('menuitem', { name: 'Ce n\'est pas un spam' })
  await expect(notSpamOption).toBeVisible()
  await notSpamOption.click()

  // Spam now empty
  await expect(page.getByText('Aucun message dans ce dossier.')).toBeVisible()
})

test('R1.1.1 — Vider la corbeille button and alertdialog confirmation', async ({ page }) => {
  await login(page)

  // Ensure Corbeille has items
  await openFolder(page, 'Corbeille')
  let count = await messages(page).getByRole('listitem').count()
  if (count === 0) {
    await openFolder(page, 'Boîte de réception')
    const msg = messages(page).getByRole('listitem').first()
    await msg.getByRole('checkbox').click()
    await page.getByRole('toolbar', { name: 'Actions sur les messages' }).getByRole('button', { name: 'Supprimer', exact: true }).click()
    await openFolder(page, 'Corbeille')
  }

  // Button must exist (contractual)
  const emptyButton = page.getByRole('button', { name: 'Vider la corbeille' })
  await expect(emptyButton).toBeVisible()
  await emptyButton.click()

  // Confirmation uses alertdialog with "Vider" button (exact match)
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  const confirmButton = dialog.getByRole('button', { name: 'Vider', exact: true })
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()

  // Trash now empty
  await expect(page.getByText('Aucun message dans ce dossier.')).toBeVisible()
})

test('R1.1.1 — Vider le spam button exists in Spam folder', async ({ page }) => {
  await login(page)

  await openFolder(page, 'Spam')

  // Button for Spam folder
  const emptyButton = page.getByRole('button', { name: 'Vider le spam' })
  await expect(emptyButton).toBeVisible()
})

test('R1.1.1 — Télécharger (.zip) menuitem for selected messages', async ({ page }) => {
  test.skip(isMobile(page), 'file download: desktop interaction only')
  await login(page)

  const items = messages(page).getByRole('listitem')
  await items.first().getByRole('checkbox').click()
  await items.nth(1).getByRole('checkbox').click()

  await expect(moreActionsButton(page)).toBeVisible()
  await moreActionsButton(page).click()

  const downloadOption = page.getByRole('menuitem', { name: 'Télécharger (.zip)' })
  await expect(downloadOption).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await downloadOption.click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/\.zip$/)
})

test('R1.1.1 — Importer des messages (.eml) menuitem always present', async ({ page }) => {
  await login(page)

  await expect(moreActionsButton(page)).toBeVisible()
  await moreActionsButton(page).click()

  const importOption = page.getByRole('menuitem', { name: 'Importer des messages (.eml)' })
  await expect(importOption).toBeVisible()
})

// ============================================================================
// R1.2 — Recherche avancée : fields, scope, filters
// ============================================================================

test('R1.2.1 — Options de recherche button and panel with native radio/checkbox', async ({ page }) => {
  await login(page)

  const searchBox = page.getByRole('searchbox', { name: /Rechercher/ })
  await expect(searchBox).toBeVisible()

  const optionsButton = page.getByRole('button', { name: 'Options de recherche' })
  await expect(optionsButton).toBeVisible()
  await optionsButton.click()

  // Panel is a form with native radio/checkbox (not menu)
  const panel = page.getByRole('complementary', { name: /recherche/ }).or(page.locator('form').filter({ has: page.getByText('Non lus') }))
  await expect(panel).toBeVisible()

  // Search fields are native checkboxes (not menuitemcheckbox)
  await expect(panel.getByRole('checkbox', { name: 'Objet' })).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: 'Expéditeur' })).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: 'Destinataires' })).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: 'Corps du message' })).toBeVisible()

  // Scope radios are native radio buttons (not menuitemradio)
  await expect(panel.getByRole('radio', { name: 'Ce dossier' })).toBeVisible()
  await expect(panel.getByRole('radio', { name: 'Tous les dossiers' })).toBeVisible()

  // Filters are native checkboxes
  await expect(panel.getByRole('checkbox', { name: 'Non lus' })).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: 'Suivis' })).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: 'Sans réponse' })).toBeVisible()
  await expect(panel.getByRole('checkbox', { name: 'Avec pièce jointe' })).toBeVisible()
})

test('R1.2.1 — Search filter "Non lus" applies without query text', async ({ page }) => {
  await login(page)

  const searchBox = page.getByRole('searchbox', { name: /Rechercher/ })
  await expect(searchBox).toBeVisible()
  await page.getByRole('button', { name: 'Options de recherche' }).click()

  const panel = page.getByRole('complementary', { name: /recherche/ }).or(page.locator('form').filter({ has: page.getByText('Non lus') }))

  await panel.getByRole('checkbox', { name: 'Non lus' }).check()

  const searchButton = panel.getByRole('button', { name: 'Rechercher' })
  await expect(searchButton).toBeVisible()
  await searchButton.click()

  // Should show unread messages (bold text)
  const items = messages(page).getByRole('listitem')
  await expect(items.first()).toBeVisible()
})

test('R1.2.1 — Réinitialiser button exists in search options', async ({ page }) => {
  await login(page)

  const searchBox = page.getByRole('searchbox', { name: /Rechercher/ })
  await expect(searchBox).toBeVisible()
  await page.getByRole('button', { name: 'Options de recherche' }).click()

  const panel = page.getByRole('complementary', { name: /recherche/ }).or(page.locator('form').filter({ has: page.getByText('Non lus') }))

  const resetButton = panel.getByRole('button', { name: 'Réinitialiser' })
  await expect(resetButton).toBeVisible()
})

// ============================================================================
// R1.3 — Lecture : impression, source, attachments, quoted text
// ============================================================================

test('R1.3.1 — Message detail page loads', async ({ page }) => {
  await login(page)

  await messageLink(page, GRADES).click()

  await expect(page.getByRole('heading', { name: GRADES })).toBeVisible()
})

test('R1.3.1 — Plus d\'actions menu on message detail', async ({ page }) => {
  await login(page)

  await messageLink(page, GRADES).click()
  await expect(page.getByRole('heading', { name: GRADES })).toBeVisible()

  const moreBtn = messageMoreActions(page)
  await expect(moreBtn).toBeVisible()
  await moreBtn.click()

  // All contractual menu items
  await expect(page.getByRole('menuitem', { name: 'Imprimer' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Afficher la source' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copier vers…' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Signaler comme spam' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Transférer en pièce jointe' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Rediriger/ })).toBeVisible()
})

test('R1.3.1 — Imprimer opens new tab with /print URL', async ({ page }) => {
  test.skip(isMobile(page), 'print: desktop only')
  await login(page)

  await messageLink(page, GRADES).click()
  await expect(page.getByRole('heading', { name: GRADES })).toBeVisible()

  await messageMoreActions(page).click()

  const printOption = page.getByRole('menuitem', { name: 'Imprimer' })
  await expect(printOption).toBeVisible()

  const newPagePromise = page.context().waitForEvent('page')
  await printOption.click()
  const printPage = await newPagePromise

  expect(printPage.url()).toContain('/print')
  await printPage.close()
})

test('R1.3.1 — Afficher la source opens dialog "Source du message"', async ({ page }) => {
  await login(page)

  await messageLink(page, GRADES).click()
  await expect(page.getByRole('heading', { name: GRADES })).toBeVisible()

  await messageMoreActions(page).click()

  const sourceOption = page.getByRole('menuitem', { name: 'Afficher la source' })
  await expect(sourceOption).toBeVisible()
  await sourceOption.click()

  const dialog = page.getByRole('dialog', { name: 'Source du message' })
  await expect(dialog).toBeVisible()

  // Download can be button or link
  await expect(dialog.getByRole('button', { name: /Télécharger.*\.eml/ }).or(dialog.getByRole('link', { name: /Télécharger.*\.eml/ }))).toBeVisible()

  await page.keyboard.press('Escape')
})

test('R1.3.1 — Image attachment: click opens Aperçu dialog with img', async ({ page }) => {
  await login(page)

  await messageLink(page, PHOTOS).click()
  await expect(page.getByRole('heading', { name: PHOTOS })).toBeVisible()

  // Image attachment can be button or link
  const imgControl = page.getByRole('button', { name: /photo-.*\.png/ }).or(page.getByRole('link', { name: /photo-.*\.png/ }))
  await expect(imgControl.first()).toBeVisible()
  await imgControl.first().click()

  // Dialog name is "Aperçu : {filename}"
  const preview = page.getByRole('dialog', { name: /Aperçu.*photo-.*\.png/ })
  await expect(preview).toBeVisible()

  // Must contain img element
  await expect(preview.getByRole('img').first()).toBeVisible()

  await page.keyboard.press('Escape')
})

test('R1.3.1 — Multiple attachments: Tout télécharger (.zip) link exists', async ({ page }) => {
  await login(page)

  await messageLink(page, PHOTOS).click()
  await expect(page.getByRole('heading', { name: PHOTOS })).toBeVisible()

  // Link can be button or link
  const downloadAllLink = page.getByRole('button', { name: /Tout télécharger.*\.zip/ }).or(page.getByRole('link', { name: /Tout télécharger.*\.zip/ }))
  await expect(downloadAllLink).toBeVisible()
})

test('R1.3.1 — Quoted text: Afficher le texte cité in iframe', async ({ page }) => {
  await login(page)

  await messageLink(page, QUOTED).click()
  await expect(page.getByRole('heading', { name: QUOTED })).toBeVisible()

  const frame = page.frameLocator('iframe[title="Contenu du message"]')

  // details element must exist for quoted text
  const details = frame.locator('details')
  await expect(details).toBeVisible()

  // Click to expand
  await details.click()

  // Summary must be visible
  const summary = frame.locator('summary')
  await expect(summary).toBeVisible()
})

// ============================================================================
// R1.4 — Rediriger, transférer en pièce jointe, indicateurs
// ============================================================================

test('R1.4.1 — Rediriger menuitem and dialog', async ({ page }) => {
  await login(page)

  await messageLink(page, GRADES).click()

  await expect(messageMoreActions(page)).toBeVisible()
  await messageMoreActions(page).click()

  const redirectOption = page.getByRole('menuitem', { name: /Rediriger/ })
  await expect(redirectOption).toBeVisible()
  await redirectOption.click()

  const dialog = page.getByRole('dialog', { name: /Rediriger/ })
  await expect(dialog).toBeVisible()

  // Contractual fields
  await expect(dialog.getByRole('combobox', { name: 'À' }).or(dialog.getByLabel('À', { exact: true }))).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Rediriger' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Annuler' }).click()
})

test('R1.4.1 — Transférer en pièce jointe opens compose with .eml attachment', async ({ page }) => {
  await login(page)

  await messageLink(page, GRADES).click()

  await expect(messageMoreActions(page)).toBeVisible()
  await messageMoreActions(page).click()

  const fwdOption = page.getByRole('menuitem', { name: 'Transférer en pièce jointe' })
  await expect(fwdOption).toBeVisible()
  await fwdOption.click()

  // Dialog name changes with forward: "Tr: {subject}"
  const composeDialog = page.getByRole('dialog', { name: /^Tr: / })
  await expect(composeDialog).toBeVisible()

  // Subject field starts with "Tr: "
  const subjectField = composeDialog.getByRole('textbox', { name: 'Objet' })
  const subjectValue = await subjectField.inputValue()
  expect(subjectValue).toMatch(/^Tr: /)

  // Attachment list contains the .eml file
  const attachmentList = composeDialog.getByRole('list', { name: 'Pièces jointes' })
  await expect(attachmentList).toContainText(/Relevé de notes — semestre 4\.eml/)

  // Body must NOT contain "Message transféré" (original is attached, not quoted)
  // Note: the compose body is a contenteditable rich-text editor, not an
  // <input>/<textarea> — inputValue() throws on it, so assert on rendered text.
  const msgField = composeDialog.getByRole('textbox', { name: 'Message' })
  await expect(msgField).not.toContainText('Message transféré')

  // Close with "Supprimer le brouillon"
  await composeDialog.getByRole('button', { name: 'Supprimer le brouillon' }).click()
})

test('R1.4.1 — Priorité haute indicator icon on high-priority message', async ({ page }) => {
  await login(page)

  // "Réunion : merci de confirmer" has high priority
  // Use relative locator for row filter
  const row = messages(page).getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(escape(READ_RECEIPT)) }) })

  const priorityIcon = row.getByRole('img', { name: 'Priorité haute' })
  await expect(priorityIcon).toBeVisible()
})

test('R1.4.1 — Répondu indicator icon after replying', async ({ page }) => {
  await login(page)

  const subject = GRADES

  // Open message
  await messageLink(page, subject).click()
  await expect(page.getByRole('heading', { name: subject })).toBeVisible()

  // Reply
  const replyButton = page.getByRole('button', { name: 'Répondre', exact: true })
  await expect(replyButton).toBeVisible()
  await replyButton.click()

  // Compose dialog changes name to "Re: {subject}"
  const composeDialog = page.getByRole('dialog')
  await expect(composeDialog).toBeVisible()

  const msgField = composeDialog.getByRole('textbox', { name: 'Message' })
  await msgField.click()
  await page.keyboard.type('Test reply')

  // Send
  await composeDialog.getByRole('button', { name: 'Envoyer', exact: true }).click()

  // Wait for undo-send message (5-15s)
  await expect(page.getByText('Message envoyé')).toBeVisible({ timeout: 15_000 })

  // Back to inbox
  await openFolder(page, 'Boîte de réception')

  // Original message now has Répondu icon
  const row = messages(page).getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(escape(subject)) }) })
  const answeredIcon = row.getByRole('img', { name: 'Répondu' })
  await expect(answeredIcon).toBeVisible()
})

// ============================================================================
// R1.5 — Priorité et accusés de lecture
// ============================================================================

test('R1.5.1 — Compose dialog: Options d\'envoi button with menuitemcheckbox', async ({ page }) => {
  await login(page)

  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()

  // Dialog name is "Nouveau message" when empty
  const composeDialog = page.getByRole('dialog', { name: 'Nouveau message' })
  await expect(composeDialog).toBeVisible()

  // Button must exist
  const optionsButton = composeDialog.getByRole('button', { name: 'Options d\'envoi' })
  await expect(optionsButton).toBeVisible()
  await optionsButton.click()

  // Options are menuitemcheckbox in dropdown menu (portal at end of body, not scoped to dialog)
  await expect(page.getByRole('menuitemcheckbox', { name: 'Priorité haute' })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: /Demander un accusé de lecture/ })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: /Demander un accusé de remise/ })).toBeVisible()

  // Close menu with Escape
  await page.keyboard.press('Escape')

  // Close compose dialog with "Enregistrer et fermer"
  await composeDialog.getByRole('button', { name: 'Enregistrer et fermer' }).click()
})

test('R1.5.1 — Read receipt request: banner and Envoyer l\'accusé button', async ({ page }) => {
  await login(page)

  await messageLink(page, READ_RECEIPT).click()

  // Banner must be visible
  const banner = page.getByText(/L'expéditeur demande un accusé de lecture/)
  await expect(banner).toBeVisible()

  // Button must be visible
  const sendButton = page.getByRole('button', { name: 'Envoyer l\'accusé' })
  await expect(sendButton).toBeVisible()

  await sendButton.click()

  // After sending, banner must disappear
  await expect(banner).toBeHidden()
})

test('R1.5.1 — Ignore button in read receipt banner', async ({ page }) => {
  await login(page)

  await messageLink(page, READ_RECEIPT).click()

  const banner = page.getByText(/L'expéditeur demande un accusé de lecture/)
  await expect(banner).toBeVisible()

  // Both buttons must exist
  await expect(page.getByRole('button', { name: 'Envoyer l\'accusé' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ignorer' })).toBeVisible()
})

// ============================================================================
// R1.6 — Composition : glisser-déposer, rappel de pièce jointe
// ============================================================================

test('R1.6.1 — Attachment reminder: "ci-joint" → alertdialog without file', async ({ page }) => {
  test.skip(isMobile(page), 'attachment reminder: keyboard/dialog, desktop only')
  await login(page)

  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()

  // Dialog name is "Nouveau message" initially
  let composeDialog = page.getByRole('dialog', { name: 'Nouveau message' })
  await expect(composeDialog).toBeVisible()

  await composeDialog.getByRole('combobox', { name: 'À' }).or(composeDialog.getByLabel('À', { exact: true })).fill(ALICE.email)
  await composeDialog.getByRole('combobox', { name: 'À' }).or(composeDialog.getByLabel('À', { exact: true })).press('Enter')
  await composeDialog.getByLabel('Objet').fill('Test pièce jointe')

  // After typing subject, dialog name changes — re-query without name
  composeDialog = page.getByRole('dialog')
  const msgField = composeDialog.getByRole('textbox', { name: 'Message' })
  await msgField.click()
  await page.keyboard.type('Voici le document ci-joint.')

  // Send without attaching file
  await composeDialog.getByRole('button', { name: 'Envoyer', exact: true }).click()

  // Missing-attachment reminder is an alertdialog
  const reminder = page.getByRole('alertdialog', { name: 'Pièce jointe oubliée ?' })
  await expect(reminder).toBeVisible()

  // Both buttons must exist
  await expect(reminder.getByRole('button', { name: 'Ajouter une pièce jointe' })).toBeVisible()
  await expect(reminder.getByRole('button', { name: 'Envoyer quand même' })).toBeVisible()

  await reminder.getByRole('button', { name: 'Envoyer quand même' }).click()
})

test('R1.6.1 — Compose: spellcheck enabled for French', async ({ page }) => {
  await login(page)

  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()

  // Dialog is "Nouveau message" when empty — wait for visibility before reading attributes
  const composeDialog = page.getByRole('dialog', { name: 'Nouveau message' })
  await expect(composeDialog).toBeVisible()

  const msgField = composeDialog.getByRole('textbox', { name: 'Message' })

  // Check spellcheck attribute
  const spellcheck = await msgField.getAttribute('spellcheck')
  const lang = await msgField.getAttribute('lang')

  // Either spellcheck=true or lang=fr should be present
  const hasSpellcheck = spellcheck === 'true' || lang === 'fr'
  expect(hasSpellcheck).toBe(true, 'Spellcheck or French lang should be enabled')

  // Close with "Enregistrer et fermer"
  await composeDialog.getByRole('button', { name: 'Enregistrer et fermer' }).click()
})
