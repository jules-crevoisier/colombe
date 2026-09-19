/**
 * Tests E2E boîte noire pour la vague F : filtres « à la Gmail », réponse
 * automatique, transfert (Sieve). Écrits à l'aveugle depuis docs/dev/PLAN-v4.md
 * (sections F et F.2) et docs/dev/PLAN-v3.md (R2.8), sans lecture de app/ server/
 * shared/. Sélecteurs accessibles uniquement (getByRole/getByLabel).
 *
 * Le backend mémoire expose un faux serveur ManageSieve : les filtres sont
 * « disponibles » (FiltersStatus.available === true) dès le départ.
 *
 * STRICT ASSERTIONS : pas de garde qui esquive une assertion contractuelle.
 * Seule l'attente d'une boîte de confirmation optionnelle (alertdialog de
 * suppression) reste conditionnelle, comme pour la boîte « Bienvenue »
 * ailleurs dans la suite (voir tests/e2e/r2.spec.ts).
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { resetMock } from '../support/reset'

const DEV = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const ALICE = { email: 'alice@mmi-troyes.fr', password: 'alice-password' }

// Données de test (docs/dev/PLAN-v3.md R1 / R2.8) : message reçu dans la boîte de
// réception de dev@mmi-troyes.fr, envoyé par « Scolarité IUT ».
const GRADES = 'Relevé de notes — semestre 4'
const SCOLARITE = 'scolarite@mmi-troyes.fr'

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function login(page: Page, who = DEV) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

/** Connexion + passage de la boîte « Bienvenue » si elle apparaît malgré resetMock. */
async function loginToInbox(page: Page, who = DEV) {
  await login(page, who)
  const welcome = page.getByRole('dialog', { name: 'Bienvenue' })
  const messageList = page.getByRole('list', { name: 'Messages' })
  await expect(welcome.or(messageList)).toBeVisible()
  await welcome.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await welcome.isVisible()) {
    await welcome.getByLabel('Nom affiché').fill(who.email.split('@')[0]!)
    await welcome.getByRole('button', { name: 'Continuer' }).click()
  }
  await expect(page).toHaveURL(/\/mail\/INBOX/)
  await expect(messageList).toBeVisible()
}

async function openMenu(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Menu principal' }).click()
}

async function openFolder(page: Page, name: string) {
  await openMenu(page)
  await page.getByRole('navigation', { name: 'Dossiers' }).getByRole('link', { name: new RegExp(`^${escape(name)}`) }).first().click()
  await expect(page.getByRole('list', { name: 'Messages' }).or(page.getByText('Aucun message dans ce dossier.'))).toBeVisible()
}

async function gotoSettings(page: Page, tab: string) {
  await page.goto(`/settings?tab=${tab}`)
}

const messages = (page: Page) => page.getByRole('list', { name: 'Messages' })
const messageLink = (page: Page, subject: string) => messages(page).getByRole('link', { name: new RegExp(escape(subject)) })

/**
 * En lecture, sur bureau (≥ 1024 px), la liste ET le message ont chacun leur
 * bouton « Plus d'actions » : on scope à la barre d'outils du message
 * (voir tests/e2e/r1.spec.ts). En mobile, la liste est masquée par le détail.
 */
const messageMoreActions = (page: Page) => isMobile(page)
  ? page.getByRole('button', { name: 'Plus d\'actions' })
  : page.getByRole('toolbar', { name: 'Actions sur le message' }).getByRole('button', { name: 'Plus d\'actions' })

/**
 * Choisit une valeur dans un contrôle role=combobox, qu'il s'agisse d'un
 * <select> natif (role=combobox implicite, valeur posée via selectOption) ou
 * d'un composant type reka Select (bouton + listbox en portail : clic puis
 * clic sur l'option).
 */
async function chooseOption(page: Page, combobox: Locator, optionName: string | RegExp) {
  await expect(combobox).toBeVisible()
  const tagName = await combobox.evaluate(el => el.tagName)
  if (tagName === 'SELECT') {
    if (typeof optionName === 'string') await combobox.selectOption({ label: optionName })
    else await combobox.selectOption({ label: (await page.getByRole('option', { name: optionName }).first().textContent()) ?? '' })
    return
  }
  await combobox.click()
  await page.getByRole('option', { name: optionName }).click()
}

async function openNewFilterDialog(page: Page) {
  await page.getByRole('button', { name: 'Nouveau filtre' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouveau filtre' })
  await expect(dialog).toBeVisible()
  return dialog
}

interface SimpleFilterOpts {
  from?: string
  subject?: string
  folder?: string
  markRead?: boolean
  applyExisting?: boolean
}

/** Remplit la boîte « Nouveau filtre » en mode simple (PLAN-v4 F.2). */
async function fillSimpleFilter(page: Page, dialog: Locator, opts: SimpleFilterOpts) {
  if (opts.from !== undefined) {
    const field = dialog.getByLabel('De', { exact: true })
    await expect(field).toBeVisible()
    await field.fill(opts.from)
  }
  if (opts.subject !== undefined) {
    const field = dialog.getByLabel('Objet', { exact: true })
    await expect(field).toBeVisible()
    await field.fill(opts.subject)
  }
  if (opts.folder !== undefined) {
    const classify = dialog.getByRole('checkbox', { name: 'Classer dans le dossier' })
    await expect(classify).toBeVisible()
    await classify.check()
    const folderControl = dialog.getByRole('combobox', { name: /dossier/i })
    await chooseOption(page, folderControl, opts.folder)
  }
  if (opts.markRead) {
    const markRead = dialog.getByRole('checkbox', { name: 'Marquer comme lu' })
    await expect(markRead).toBeVisible()
    await markRead.check()
  }
  if (opts.applyExisting) {
    const apply = dialog.getByRole('checkbox', { name: 'Appliquer aussi aux messages existants' })
    await expect(apply).toBeVisible()
    await apply.check()
  }
}

/** Case à cocher ou interrupteur (aria-checked dans les deux cas) : on ne sait pas lequel du contrat. */
const toggleControl = (page: Page, name: string) =>
  page.getByRole('switch', { name }).or(page.getByRole('checkbox', { name }))

const notifications = (page: Page) => page.getByRole('region', { name: 'Notifications' })

test.beforeEach(async ({ request }) => {
  await resetMock(request)
})

// ============================================================================
// 1. Boîte « Nouveau filtre » (mode simple) : champs, actions, création
// ============================================================================

test('F.2.1 — Onglet Filtres : "Nouveau filtre" crée un filtre visible dans la liste', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'filters')
  await expect(page.getByRole('heading', { name: 'Filtres', level: 2 })).toBeVisible()

  const dialog = await openNewFilterDialog(page)
  await fillSimpleFilter(page, dialog, { from: SCOLARITE, subject: 'Relevé', folder: 'Projets', markRead: true })

  await dialog.getByRole('button', { name: 'Créer le filtre' }).click()
  await expect(dialog).toBeHidden()

  // La liste des filtres n'a pas de rôle ARIA imposé par le contrat : on
  // repère la ligne par son texte lisible (« De : … → Classer dans Projets, … »)
  // plutôt que de dépendre d'un rôle listitem.
  await expect(page.getByText(new RegExp(`${escape(SCOLARITE)}.*Projets`))).toBeVisible()
})

// ============================================================================
// 2. Appliquer aussi aux messages existants
// ============================================================================

test('F.2.2 — "Appliquer aussi aux messages existants" classe le message déjà reçu et le retire de la boîte de réception', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'filters')

  const dialog = await openNewFilterDialog(page)
  await fillSimpleFilter(page, dialog, { from: SCOLARITE, folder: 'Projets', applyExisting: true })
  await dialog.getByRole('button', { name: 'Créer le filtre' }).click()

  await expect(notifications(page).getByText(/Filtre appliqué à \d+ message/)).toBeVisible()
  await expect(dialog).toBeHidden()

  await page.goto('/mail/INBOX')
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
  await expect(messageLink(page, GRADES)).toBeHidden()

  await openFolder(page, 'Projets')
  await expect(messageLink(page, GRADES)).toBeVisible()
})

// ============================================================================
// 3. Créer un filtre depuis la recherche
// ============================================================================

test('F.2.3 — "Créer un filtre" depuis les options de recherche ouvre "Nouveau filtre" prérempli', async ({ page }) => {
  await loginToInbox(page)

  const searchBox = page.getByRole('searchbox', { name: /Rechercher/ })
  await expect(searchBox).toBeVisible()
  await searchBox.fill('semestre')

  await page.getByRole('button', { name: 'Options de recherche' }).click()
  const panel = page.getByRole('complementary', { name: /recherche/ }).or(page.locator('form').filter({ has: page.getByText('Non lus') }))
  await expect(panel).toBeVisible()
  await panel.getByRole('checkbox', { name: 'Objet' }).check()

  const createFilterButton = panel.getByRole('button', { name: 'Créer un filtre' })
  await expect(createFilterButton).toBeVisible()
  await createFilterButton.click()

  const dialog = page.getByRole('dialog', { name: 'Nouveau filtre' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Objet', { exact: true })).toHaveValue(/semestre/i)
})

// ============================================================================
// 4. Créer un filtre depuis un message
// ============================================================================

test('F.2.4 — "Créer un filtre…" depuis un message préremplit "De" avec l\'expéditeur', async ({ page }) => {
  await loginToInbox(page)
  await messageLink(page, GRADES).click()
  await expect(page.getByRole('heading', { name: GRADES })).toBeVisible()

  await messageMoreActions(page).click()
  await page.getByRole('menuitem', { name: /Créer un filtre/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Nouveau filtre' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('De', { exact: true })).toHaveValue(new RegExp(escape(SCOLARITE)))
})

// ============================================================================
// 5. Sécurité : transfert vers un domaine interdit / confirmation d'identité
// ============================================================================

test('F.5.1 — Transfert vers un domaine hors liste autorisée est refusé', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'forward')
  await expect(page.getByRole('heading', { name: 'Transfert', level: 2 })).toBeVisible()

  const forwardField = page.getByLabel('Transférer tous mes messages à')
  await expect(forwardField).toBeVisible()
  await forwardField.fill('attacker@evil.example')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect(page.getByText('Transfert interdit vers ce domaine.')).toBeVisible()
})

test('F.5.2 — Transfert vers un domaine autorisé exige la confirmation du mot de passe du compte connecté, puis persiste', async ({ page }) => {
  // Le compte connecté est dev@mmi-troyes.fr ; alice@mmi-troyes.fr n'est ici que
  // l'adresse de destination du transfert (domaine autorisé). La confirmation
  // d'identité porte donc sur le mot de passe de dev, pas celui d'alice.
  await loginToInbox(page, DEV)
  await gotoSettings(page, 'forward')
  await expect(page.getByRole('heading', { name: 'Transfert', level: 2 })).toBeVisible()

  const forwardField = page.getByLabel('Transférer tous mes messages à')
  await expect(forwardField).toBeVisible()
  await forwardField.fill(ALICE.email)
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  const confirm = page.getByRole('dialog', { name: 'Confirmez votre identité' })
  await expect(confirm).toBeVisible()
  await confirm.getByLabel('Mot de passe').fill(DEV.password)
  await confirm.getByRole('button', { name: 'Confirmer' }).click()
  await expect(confirm).toBeHidden()

  await page.reload()
  await expect(page.getByLabel('Transférer tous mes messages à')).toHaveValue(ALICE.email)
})

// ============================================================================
// 6. Réponse automatique (vacation)
// ============================================================================

test('F.6.1 — Activer la réponse automatique, renseigner Objet et Message, valeurs persistées après rechargement', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'vacation')
  await expect(page.getByRole('heading', { name: 'Réponse automatique', level: 2 })).toBeVisible()

  const enable = toggleControl(page, 'Activer la réponse automatique')
  await expect(enable).toBeVisible()
  await enable.click()
  await expect(enable).toBeChecked()

  await page.getByLabel('Objet', { exact: true }).fill('Absence du bureau')
  await page.getByLabel('Message', { exact: true }).fill('Je suis absent, réponse à mon retour.')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await page.reload()
  await expect(toggleControl(page, 'Activer la réponse automatique')).toBeChecked()
  await expect(page.getByLabel('Objet', { exact: true })).toHaveValue('Absence du bureau')
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Je suis absent, réponse à mon retour.')
})

// ============================================================================
// 7. Mode avancé
// ============================================================================

test('F.7.1 — "Mode avancé" révèle "Ensemble de filtres" et "Modifier le script"', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'filters')
  await expect(page.getByRole('heading', { name: 'Filtres', level: 2 })).toBeVisible()

  const setSelector = page.getByRole('combobox', { name: 'Ensemble de filtres' })
  const editScriptButton = page.getByRole('button', { name: 'Modifier le script' })
  await expect(setSelector).toBeHidden()
  await expect(editScriptButton).toBeHidden()

  const advancedToggle = toggleControl(page, 'Mode avancé').or(page.getByRole('button', { name: 'Mode avancé' }))
  await expect(advancedToggle).toBeVisible()
  await advancedToggle.click()

  await expect(setSelector).toBeVisible()
  await expect(editScriptButton).toBeVisible()
})

// ============================================================================
// 8. Modifier / supprimer un filtre
// ============================================================================

test('F.8.1 — "Modifier" rouvre la boîte de dialogue, "Supprimer" retire le filtre de la liste', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'filters')

  const dialog = await openNewFilterDialog(page)
  await fillSimpleFilter(page, dialog, { from: SCOLARITE, markRead: true })
  await dialog.getByRole('button', { name: 'Créer le filtre' }).click()
  await expect(dialog).toBeHidden()

  // Un seul filtre existe à ce stade (reset par test) : on repère sa ligne par
  // son texte lisible plutôt que par un rôle de liste non garanti par le
  // contrat, et on agit sur les boutons "Modifier"/"Supprimer" globaux de
  // l'onglet, sans ambiguïté puisqu'il n'y a qu'une ligne.
  const filterLine = page.getByText(new RegExp(escape(SCOLARITE)))
  await expect(filterLine).toBeVisible()

  await page.getByRole('button', { name: 'Modifier' }).click()
  const editDialog = page.getByRole('dialog')
  await expect(editDialog).toBeVisible()
  await expect(editDialog.getByRole('button', { name: 'Enregistrer' })).toBeVisible()
  await editDialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(editDialog).toBeHidden()

  await page.getByRole('button', { name: 'Supprimer' }).click()
  const confirm = page.getByRole('alertdialog')
  await confirm.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
  if (await confirm.isVisible()) {
    await confirm.getByRole('button', { name: 'Supprimer' }).click()
  }

  await expect(filterLine).toBeHidden()
})
