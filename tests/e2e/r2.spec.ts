/**
 * Tests E2E boîte noire pour la vague R2 : identités, réponses types, carnet
 * complet, dossiers, réglages, volet de lecture, compte et sécurité.
 * Sélecteurs accessibles uniquement (getByRole/getByLabel/getByText avec les
 * libellés contractuels). Voir docs/dev/PLAN-v3.md (R2.1-R2.8) et docs/dev/ROADMAP.md
 * (R2.1b images, R2.7 fils/sélection/liste de diffusion).
 *
 * STRICT ASSERTIONS : les éléments contractuels DOIVENT exister (pas de garde
 * qui esquive l'assertion). Une échec révèle une fonction R2 manquante ou
 * cassée.
 *
 * Boîte de dialogue « Bienvenue » : comme le jeu de données mémoire repart de
 * zéro à chaque `__mock/reset` et que chaque test Playwright démarre un
 * contexte neuf (aucun cookie hérité), la première connexion de CHAQUE test
 * peut déclencher la boîte « Bienvenue » (R2.1). `loginToInbox` l'absorbe
 * pour ne pas bloquer les scénarios qui ne testent pas cette boîte elle-même ;
 * un test dédié vérifie son contenu exact.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const DEV = { email: 'dev@universite.example', password: 'dev-password' }
const ALICE = { email: 'alice@universite.example', password: 'alice-password' }

// Données de test R2 (docs/dev/PLAN-v3.md section R2.8)
const LIST_MESSAGE = 'Liste Promo 2026 : réunion de rentrée'
const VCARD_MESSAGE = 'Carte de visite de Léa'

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function login(page: Page, who = DEV) {
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

/** Connexion + passage de la boîte « Bienvenue » si elle apparaît (voir en-tête). */
async function loginToInbox(page: Page, who = DEV) {
  await login(page, who)
  const welcome = page.getByRole('dialog', { name: 'Bienvenue' })
  const messageList = page.getByRole('list', { name: 'Messages' })
  await expect(welcome.or(messageList)).toBeVisible()
  // La boîte s'ouvre une fois les préférences chargées, parfois après la liste :
  // on lui laisse le temps d'apparaître avant de conclure qu'elle est absente.
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

/** Mobile : la fiche remplace la liste ; on revient à la liste. */
async function backToContactsList(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Retour à la liste' }).click()
}

async function gotoContacts(page: Page) {
  await openMenu(page)
  await page.getByRole('link', { name: 'Contacts' }).click()
  await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible()
}

async function logout(page: Page, who = DEV) {
  await page.getByRole('button', { name: `Compte ${who.email}` }).click()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
}

const messages = (page: Page) => page.getByRole('list', { name: 'Messages' })
const messageLink = (page: Page, subject: string) => messages(page).getByRole('link', { name: new RegExp(escape(subject)) })
// Un nom de contact apparaît à plusieurs endroits (liste, fiche…) : on scope les
// recherches à la liste nommée « Contacts » pour éviter les correspondances multiples.
const contactsList = (page: Page) => page.getByRole('list', { name: 'Contacts' })

/** Choisit une valeur dans un composant combobox (bouton + listbox en portail). */
async function chooseOption(page: Page, combobox: ReturnType<Page['getByRole']>, optionName: string | RegExp) {
  await combobox.click()
  await page.getByRole('option', { name: optionName }).click()
}

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/__mock/reset', { headers: { origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin } })
  expect(res.status()).toBe(204)
})

// ============================================================================
// R2.1 — Identités
// ============================================================================

test('R2.1.1 — Onglet Identités : ajouter une identité et la choisir en rédaction', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'identities')
  await expect(page.getByRole('heading', { name: 'Identités', level: 2 })).toBeVisible()

  await page.getByRole('button', { name: 'Ajouter une identité' }).click()
  await page.getByLabel('Nom affiché').fill('Support Campus')
  await page.getByLabel('Répondre à').fill('support@universite.example')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Support Campus')).toBeVisible()

  await page.goto('/mail/INBOX')
  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const fromSelector = dialog.getByRole('combobox', { name: 'De' })
  await expect(fromSelector).toBeVisible()
  await chooseOption(page, fromSelector, /Support Campus/)
  await expect(fromSelector).toContainText('Support Campus')

  await dialog.getByRole('button', { name: 'Supprimer le brouillon' }).click()
})

test('R2.1.2 — Supprimer une identité demande confirmation avant de la retirer', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'identities')
  await expect(page.getByRole('heading', { name: 'Identités', level: 2 })).toBeVisible()

  await page.getByRole('button', { name: 'Ajouter une identité' }).click()
  await page.getByLabel('Nom affiché').fill('Temporaire')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  // Un champ (p. ex. la signature d'une autre identité) peut aussi contenir
  // le texte « Temporaire » : on scope la recherche à la liste des identités.
  const identitiesList = page.getByRole('list', { name: 'Identités' })
  await expect(identitiesList.getByText('Temporaire')).toBeVisible()
  await identitiesList.getByText('Temporaire').click()

  const deleteButton = page.getByRole('button', { name: 'Supprimer l\'identité' })
  await expect(deleteButton).toBeVisible()
  await deleteButton.click()

  const confirm = page.getByRole('alertdialog', { name: 'Supprimer cette identité ?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Supprimer l\'identité' }).click()

  await expect(identitiesList.getByText('Temporaire')).toBeHidden()
})

test('R2.1.3 — Première connexion : boîte "Bienvenue" avec Nom affiché puis Continuer', async ({ page }) => {
  await login(page)
  const dialog = page.getByRole('dialog', { name: 'Bienvenue' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Nom affiché')).toBeVisible()
  await dialog.getByLabel('Nom affiché').fill('Dev Utilisateur')
  await dialog.getByRole('button', { name: 'Continuer' }).click()
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible()
})

// ============================================================================
// R2.1b (ROADMAP) — Image dans la signature
// ============================================================================

test('R2.1b.1 — Insérer une image dans la signature de l\'identité', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'identities')
  await expect(page.getByRole('heading', { name: 'Identités', level: 2 })).toBeVisible()

  const signatureEditor = page.getByRole('textbox', { name: 'Signature' })
  await expect(signatureEditor).toBeVisible()

  const insertImageButton = page.getByRole('button', { name: 'Insérer une image' })
  await expect(insertImageButton).toBeVisible()
  await insertImageButton.click()

  await page.setInputFiles('input[type="file"]', {
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_B64, 'base64'),
  })

  const insertImageDialog = page.getByRole('dialog', { name: 'Insérer une image' })
  await expect(insertImageDialog).toBeVisible()
  await insertImageDialog.getByLabel('Texte alternatif').fill('Logo Université Exemple')
  await insertImageDialog.getByRole('button', { name: 'Insérer' }).click()

  await expect(signatureEditor.locator('img[alt="Logo Université Exemple"]')).toBeVisible()
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
})

// ============================================================================
// R2.2 — Réponses types
// ============================================================================

test('R2.2.1 — Créer une réponse type puis l\'insérer en rédaction', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'responses')
  await expect(page.getByRole('heading', { name: 'Réponses types', level: 2 })).toBeVisible()

  await page.getByRole('button', { name: 'Nouvelle réponse type' }).click()
  await page.getByLabel('Nom').fill('Merci')
  await page.getByRole('textbox', { name: 'Texte' }).click()
  await page.keyboard.type('Merci pour votre message.')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Merci', { exact: true })).toBeVisible()

  await page.goto('/mail/INBOX')
  await page.getByRole('button', { name: 'Nouveau message', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const body = dialog.getByRole('textbox', { name: 'Message' })
  await body.click()

  await dialog.getByRole('button', { name: 'Insérer une réponse type' }).click()
  await page.getByRole('menuitem', { name: 'Merci' }).click()

  await expect(body).toContainText('Merci pour votre message.')
  await dialog.getByRole('button', { name: 'Supprimer le brouillon' }).click()
})

// ============================================================================
// R2.3 — Carnet d'adresses complet
// ============================================================================

test('R2.3.1 — Nouveau contact, modification, "Écrire un message"', async ({ page }) => {
  await loginToInbox(page)
  await gotoContacts(page)

  await page.getByRole('button', { name: 'Nouveau contact' }).click()
  await page.getByLabel('Prénom').fill('Marc')
  await page.getByLabel('Nom', { exact: true }).fill('Petit')
  await page.getByLabel('E-mail').first().fill('marc.petit@example.com')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await backToContactsList(page)
  await expect(contactsList(page).getByText('Marc Petit')).toBeVisible()

  await contactsList(page).getByText('Marc Petit').click()
  await expect(page.getByRole('heading', { name: 'Marc Petit' })).toBeVisible()
  await page.getByRole('button', { name: 'Modifier' }).click()
  await page.getByLabel('Fonction').fill('Enseignant')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Enseignant')).toBeVisible()

  await page.getByRole('button', { name: 'Écrire un message' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('marc.petit@example.com')
  await dialog.getByRole('button', { name: 'Supprimer le brouillon' }).click()
})

test('R2.3.2 — Nouveau groupe, ajout d\'un contact au groupe', async ({ page }) => {
  await loginToInbox(page)
  await gotoContacts(page)

  await page.getByRole('button', { name: 'Nouveau contact' }).click()
  await page.getByLabel('Prénom').fill('Léa')
  await page.getByLabel('Nom', { exact: true }).fill('Dubois')
  await page.getByLabel('E-mail').first().fill('lea.dubois@universite.example')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await backToContactsList(page)
  await expect(contactsList(page).getByText('Léa Dubois')).toBeVisible()

  await page.getByRole('button', { name: 'Nouveau groupe' }).click()
  await page.getByLabel('Nom').fill('Enseignants')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Enseignants')).toBeVisible()

  await contactsList(page).getByText('Léa Dubois').click()
  await page.getByRole('button', { name: 'Ajouter au groupe' }).click()
  await page.getByRole('menuitem', { name: 'Enseignants' }).click()
  await backToContactsList(page)

  await page.getByRole('navigation', { name: 'Groupes de contacts' }).getByText('Enseignants', { exact: true }).click()
  await expect(contactsList(page).getByText('Léa Dubois')).toBeVisible()
})

test('R2.3.3 — "Importer ce contact" depuis la pièce jointe vCard du message', async ({ page }) => {
  await loginToInbox(page)
  await messageLink(page, VCARD_MESSAGE).click()
  await expect(page.getByRole('heading', { name: VCARD_MESSAGE })).toBeVisible()

  const importButton = page.getByRole('button', { name: 'Importer ce contact' })
  await expect(importButton).toBeVisible()
  await importButton.click()

  await gotoContacts(page)
  await expect(contactsList(page).getByText('Léa Dubois')).toBeVisible()
})

test('R2.3.4 — "Ajouter aux contacts" disparaît une fois l\'expéditeur enregistré', async ({ page }) => {
  await loginToInbox(page)
  await messageLink(page, LIST_MESSAGE).click()
  await expect(page.getByRole('heading', { name: LIST_MESSAGE })).toBeVisible()

  const addButton = page.getByRole('button', { name: 'Ajouter aux contacts' })
  await expect(addButton).toBeVisible()
  await addButton.click()
  await expect(addButton).toBeHidden()
})

// ============================================================================
// R2.4 — Dossiers
// ============================================================================

test('R2.4.1 — Sous-dossier "2026" visible sous "Projets" dans la barre latérale', async ({ page }) => {
  await loginToInbox(page)
  await openMenu(page)
  const sidebar = page.getByRole('navigation', { name: 'Dossiers' })
  await expect(sidebar.getByRole('link', { name: /^Projets/ })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: /^2026/ })).toBeVisible()
})

test('R2.4.2 — Dossier "Anciens cours" masqué par défaut, visible après activation dans Réglages → Dossiers', async ({ page }) => {
  await loginToInbox(page)
  await openMenu(page)
  await expect(page.getByRole('navigation', { name: 'Dossiers' }).getByRole('link', { name: /Anciens cours/ })).toBeHidden()

  await gotoSettings(page, 'folders')
  await expect(page.getByRole('heading', { name: 'Dossiers', level: 2 })).toBeVisible()
  const row = page.getByRole('row', { name: /Anciens cours/ })
  const toggle = row.getByRole('switch', { name: 'Afficher Anciens cours' })
  await expect(toggle).toBeVisible()
  await toggle.click()

  await page.goto('/mail/INBOX')
  await openMenu(page)
  await expect(page.getByRole('navigation', { name: 'Dossiers' }).getByRole('link', { name: /Anciens cours/ })).toBeVisible()
})

test('R2.4.3 — Jauge "Espace utilisé" visible dans la barre latérale', async ({ page }) => {
  await loginToInbox(page)
  await openMenu(page)
  // « Espace utilisé » existe deux fois dans le DOM sur mobile (rail + tiroir) :
  // on ne garde que la version visible.
  await expect(page.getByText('Espace utilisé').filter({ visible: true })).toBeVisible()
})

// ============================================================================
// R2.5 — Volet de lecture et affichage
// ============================================================================

test('R2.5.1 — Volet de lecture : la liste reste visible après ouverture d\'un message (bureau ≥1024px)', async ({ page }) => {
  test.skip(isMobile(page), 'volet de lecture : bureau uniquement')
  await loginToInbox(page)
  await messageLink(page, LIST_MESSAGE).click()
  await expect(page.getByRole('heading', { name: LIST_MESSAGE })).toBeVisible()
  await expect(messages(page)).toBeVisible()
  await expect(page).toHaveURL(/\/mail\/INBOX\/\d+/)
})

test('R2.5.2 — Format de l\'heure 12 h affiche AM/PM', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'general')
  await expect(page.getByRole('heading', { name: 'Général', level: 2 })).toBeVisible()

  const timeFormat = page.getByRole('combobox', { name: 'Format de l\'heure' })
  await expect(timeFormat).toBeVisible()
  await chooseOption(page, timeFormat, '12 h')

  // En format « relative », seuls les messages du jour même affichent une heure
  // dans la liste (test alors dépendant de l'heure de la nuit) : on ouvre un
  // message et on vérifie la date complète de son en-tête.
  await page.goto('/mail/INBOX')
  await messageLink(page, LIST_MESSAGE).click()
  await expect(page.getByRole('heading', { name: LIST_MESSAGE })).toBeVisible()
  await expect(page.getByRole('main').getByText(/\b(AM|PM)\b/).filter({ visible: true }).first()).toBeVisible()
})

test('R2.5.3 — Sections des Réglages accessibles par onglet', async ({ page }) => {
  await loginToInbox(page)
  const sections: Record<string, string> = {
    identities: 'Identités',
    responses: 'Réponses types',
    general: 'Général',
    display: 'Affichage',
    compose: 'Rédaction',
    server: 'Serveur',
    folders: 'Dossiers',
    security: 'Sécurité',
  }
  for (const [tab, heading] of Object.entries(sections)) {
    await gotoSettings(page, tab)
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
  }
})

// ============================================================================
// R2.7 (ROADMAP) — Fils, sélection, liste de diffusion
// ============================================================================

test('R2.7.1 — "Répondre à la liste" sur un message de liste de diffusion', async ({ page }) => {
  await loginToInbox(page)
  await messageLink(page, LIST_MESSAGE).click()
  await expect(page.getByRole('heading', { name: LIST_MESSAGE })).toBeVisible()

  const replyToList = page.getByRole('button', { name: 'Répondre à la liste' })
  await expect(replyToList).toBeVisible()
  await replyToList.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Les destinataires sont des puces à côté du champ « À » : le champ texte lui-même
  // reste vide, on cherche donc l'adresse dans l'ensemble de la boîte de dialogue.
  await expect(dialog).toContainText('liste-promo2026@universite.example')
  await dialog.getByRole('button', { name: 'Supprimer le brouillon' }).click()
})

test('R2.7.2 — Menu de sélection "Non lus" ne sélectionne que les messages non lus', async ({ page }) => {
  await loginToInbox(page)

  await expect(page.getByRole('checkbox', { name: 'Tout sélectionner' })).toBeVisible()
  // Nom accessible exact : une regex /sélection/i correspondrait aussi à chaque
  // « Sélectionner « … » » des lignes de la liste.
  const selectionMenuButton = page.getByRole('button', { name: 'Options de sélection', exact: true })
  await expect(selectionMenuButton).toBeVisible()
  await selectionMenuButton.click()
  await page.getByRole('menuitem', { name: 'Non lus' }).click()

  // Bureau : case à cocher ; mobile : bouton avatar « Désélectionner « … » »
  // avec aria-pressed=true (pas de case à cocher sur les lignes en mobile).
  const checkedRows = isMobile(page)
    ? messages(page).getByRole('listitem').filter({ has: page.getByRole('button', { pressed: true, name: /^Désélectionner/ }) })
    : messages(page).getByRole('listitem').filter({ has: page.getByRole('checkbox', { checked: true }) })

  // locator.count() ne patiente pas : on attend d'abord qu'au moins une ligne soit cochée.
  await expect(checkedRows.first()).toBeVisible()
  const checkedCount = await checkedRows.count()
  expect(checkedCount).toBeGreaterThan(0)
  const checkedUnreadCount = await checkedRows.filter({ has: page.locator('span.font-bold') }).count()
  expect(checkedUnreadCount).toBe(checkedCount)
})

// ============================================================================
// R2.6 — Compte et sécurité
// ============================================================================

test('R2.6.1 — Onglet Sécurité : dernière connexion, sessions actives, déconnexion des autres sessions', async ({ page }) => {
  await loginToInbox(page)
  await gotoSettings(page, 'security')
  await expect(page.getByRole('heading', { name: 'Sécurité', level: 2 })).toBeVisible()
  await expect(page.getByText(/Dernière connexion/)).toBeVisible()
  await expect(page.getByText('Sessions actives')).toBeVisible()

  const revokeButton = page.getByRole('button', { name: 'Déconnecter les autres sessions' })
  await expect(revokeButton).toBeVisible()
})
