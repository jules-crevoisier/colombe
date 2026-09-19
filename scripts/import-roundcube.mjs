#!/usr/bin/env node
/**
 * import-roundcube — importe les contacts, groupes, identités et réponses types d'une
 * installation Roundcube vers la base SQLite de Colombe. Lit soit un dossier de .tsv
 * produits par scripts/roundcube-export/{mysql,postgres}.sh, soit directement une base
 * SQLite Roundcube (--sqlite).
 *
 * Par défaut : DRY RUN (rien n'est écrit, un décompte par utilisateur est affiché).
 * --apply écrit réellement, une transaction par utilisateur. Ré-exécutable sans
 * doublons (voir scripts/lib/roundcube.mjs : correspondance par adresse/nom).
 *
 * Zéro dépendance npm (Node 24 built-ins uniquement).
 */
import { isMainModule } from './lib/self-exec.mjs'

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve as resolvePath, join } from 'node:path'
import process from 'node:process'
import {
  applyContactImport,
  applyGroupImport,
  applyGroupMember,
  applyIdentityImport,
  applyResponseImport,
  parseTsvTable,
  usernameToEmail,
} from './lib/roundcube.mjs'

const HELP = `import-roundcube — importe contacts/groupes/identités/réponses depuis Roundcube

Usage :
  node scripts/import-roundcube.mjs --from <dossier-tsv> [options]
  node scripts/import-roundcube.mjs --sqlite <fichier.sqlite> [options]

Options :
  --from <dossier>     Dossier produit par scripts/roundcube-export/{mysql,postgres}.sh
  --sqlite <fichier>   Base SQLite Roundcube à lire directement
  --domain <domaine>   Domaine ajouté aux identifiants Roundcube sans « @ » (obligatoire
                        si au moins un « username » n'en contient pas)
  --data-dir <chemin>  Dossier de données Colombe (défaut .data, comme WEBMAIL_DATA_DIR)
  --only a@b,c@d        Limite l'import à ces adresses (owner) uniquement
  --apply               Écrit réellement (sinon : DRY RUN, par défaut)
  --help                 Affiche cette aide

Colombe DOIT être arrêté pendant --apply (verrou SQLite WAL sinon possible).
La base Colombe doit déjà exister (démarrez Colombe une fois pour la créer).
`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') { args.help = true; continue }
    if (a === '--apply') { args.apply = true; continue }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[key] = true
      else { args[key] = next; i++ }
      continue
    }
  }
  return args
}

function printTable(rows) {
  if (!rows.length) { console.log('(aucune ligne)'); return }
  const cols = Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))
  const line = cells => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ')
  console.log(line(cols))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(cols.map(c => r[c] ?? '')))
}

function truthy(v) {
  return v === true || v === 1 || v === '1'
}

// ---------------------------------------------------------------------------
// Chargement des données sources (dossier .tsv ou base SQLite Roundcube)
// ---------------------------------------------------------------------------

const TABLES = {
  users: ['user_id', 'username', 'mail_host'],
  contacts: ['contact_id', 'user_id', 'name', 'email', 'firstname', 'surname', 'vcard', 'del'],
  contactgroups: ['contactgroup_id', 'user_id', 'name', 'del'],
  contactgroupmembers: ['contactgroup_id', 'contact_id'],
  identities: ['identity_id', 'user_id', 'standard', 'name', 'organization', 'email', 'reply_to', 'bcc', 'signature', 'html_signature', 'del'],
  responses: ['response_id', 'user_id', 'name', 'data', 'is_html', 'del'],
}

function loadFromTsvDir(dir) {
  const data = {}
  for (const [table, columns] of Object.entries(TABLES)) {
    const file = join(dir, `${table}.tsv`)
    if (!existsSync(file)) {
      if (table === 'responses') { data.responses = null; data.responsesWarning = `${file} absent (Roundcube < 1.5 ? réponses peut-être dans users.preferences, non importées).`; continue }
      throw new Error(`Fichier attendu introuvable : ${file} (avez-vous lancé scripts/roundcube-export/{mysql,postgres}.sh ?).`)
    }
    data[table] = parseTsvTable(readFileSync(file, 'utf8'), columns)
  }
  return data
}

async function loadFromSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  const data = {}
  // `sqlColumns` sont les expressions SQL envoyées telles quelles (peuvent contenir un
  // alias `AS`) ; le nom de propriété du résultat doit alors correspondre à `columns`.
  const select = (table, columns, sqlColumns = columns) => {
    const rows = db.prepare(`SELECT ${sqlColumns.join(', ')} FROM ${table}`).all()
    return rows.map((r) => {
      const out = {}
      columns.forEach((c) => { out[c] = r[c] })
      return out
    })
  }
  data.users = select('users', TABLES.users)
  data.contacts = select('contacts', TABLES.contacts)
  data.contactgroups = select('contactgroups', TABLES.contactgroups)
  data.contactgroupmembers = select('contactgroupmembers', TABLES.contactgroupmembers)
  data.identities = select(
    'identities',
    TABLES.identities,
    ['identity_id', 'user_id', 'standard', 'name', 'organization', 'email', '"reply-to" AS reply_to', 'bcc', 'signature', 'html_signature', 'del']
  )
  try {
    data.responses = select('responses', TABLES.responses)
  }
  catch {
    data.responses = null
    data.responsesWarning = 'Table responses absente (Roundcube < 1.5 ? réponses peut-être dans users.preferences, non importées).'
  }
  db.close()
  return data
}

// ---------------------------------------------------------------------------
// Construction d'une fiche contact importable à partir d'une ligne + vCard
// ---------------------------------------------------------------------------

function buildContactRecord(row, parseVCards) {
  const fallbackEmail = String(row.email || '').trim().toLowerCase()
  let base = null
  if (row.vcard && String(row.vcard).trim() && parseVCards) {
    try {
      const cards = parseVCards(row.vcard)
      if (cards.length) base = cards[0]
    }
    catch {
      base = null
    }
  }
  if (!base) {
    return {
      firstName: row.firstname || '',
      lastName: row.surname || '',
      displayName: row.name || '',
      emails: fallbackEmail ? [{ label: 'other', address: fallbackEmail }] : [],
      phones: [],
      organization: '',
      jobTitle: '',
      birthday: null,
      notes: '',
    }
  }
  const emails = [...base.emails]
  if (fallbackEmail && !emails.some(e => e.address === fallbackEmail)) emails.unshift({ label: 'other', address: fallbackEmail })
  return {
    firstName: base.firstName || row.firstname || '',
    lastName: base.lastName || row.surname || '',
    displayName: base.displayName || row.name || '',
    emails,
    phones: base.phones,
    organization: base.organization,
    jobTitle: base.jobTitle,
    birthday: base.birthday,
    notes: '',
  }
}

// ---------------------------------------------------------------------------
// Import d'un utilisateur (fonction pure-ish : ne dépend que de `db` et des données)
// ---------------------------------------------------------------------------

export function importOneUser(db, owner, userId, data, { parseVCards } = {}) {
  const stats = {
    contacts: { created: 0, merged: 0, skipped: 0 },
    groups: { created: 0, exists: 0 },
    groupMembers: 0,
    identities: { created: 0, updated: 0, skipped: 0 },
    responses: { created: 0, updated: 0, skipped: 0 },
  }

  const contactIdMap = new Map() // roundcube contact_id -> colombe contact id
  for (const row of data.contacts.filter(c => String(c.user_id) === String(userId) && !truthy(c.del))) {
    const record = buildContactRecord(row, parseVCards)
    const result = applyContactImport(db, owner, record)
    if (result.status === 'created') stats.contacts.created++
    else if (result.status === 'merged') stats.contacts.merged++
    else stats.contacts.skipped++
    if (result.id) contactIdMap.set(String(row.contact_id), result.id)
  }

  const groupIdMap = new Map() // roundcube contactgroup_id -> colombe group id
  for (const row of data.contactgroups.filter(g => String(g.user_id) === String(userId) && !truthy(g.del))) {
    const result = applyGroupImport(db, owner, row.name)
    if (result.status === 'created') stats.groups.created++
    else if (result.status === 'exists') stats.groups.exists++
    if (result.id) groupIdMap.set(String(row.contactgroup_id), result.id)
  }

  for (const row of data.contactgroupmembers) {
    const groupId = groupIdMap.get(String(row.contactgroup_id))
    const contactId = contactIdMap.get(String(row.contact_id))
    if (groupId && contactId) {
      applyGroupMember(db, groupId, contactId)
      stats.groupMembers++
    }
  }

  for (const row of data.identities.filter(i => String(i.user_id) === String(userId) && !truthy(i.del))) {
    const record = {
      name: row.name,
      replyTo: row.reply_to,
      bcc: row.bcc,
      organization: row.organization,
      signature: row.signature,
      htmlSignature: truthy(row.html_signature),
      email: row.email,
      standard: truthy(row.standard),
    }
    const result = applyIdentityImport(db, owner, record)
    if (result.status === 'created') stats.identities.created++
    else if (result.status === 'exists') stats.identities.updated++
    else stats.identities.skipped++
  }

  if (data.responses) {
    for (const row of data.responses.filter(r => String(r.user_id) === String(userId) && !truthy(r.del))) {
      const result = applyResponseImport(db, owner, { name: row.name, data: row.data, isHtml: truthy(row.is_html) })
      if (result.status === 'created') stats.responses.created++
      else if (result.status === 'exists') stats.responses.updated++
      else stats.responses.skipped++
    }
  }

  return stats
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(HELP); return }

  if (!args.from && !args.sqlite) {
    console.error('Indiquez --from <dossier-tsv> ou --sqlite <fichier> (voir --help).')
    process.exitCode = 1
    return
  }
  if (args.from && args.sqlite) {
    console.error('--from et --sqlite sont exclusifs, choisissez-en un seul.')
    process.exitCode = 1
    return
  }

  const dataDir = resolvePath(process.cwd(), args.dataDir || '.data')
  const dbFile = join(dataDir, 'webmail.sqlite')
  if (!existsSync(dbFile)) {
    console.error(`La base Colombe est introuvable (${dbFile}).`)
    console.error('Démarrez Colombe une fois (elle crée la base au premier lancement), puis relancez cet import.')
    process.exitCode = 1
    return
  }

  let data
  try {
    data = args.from ? loadFromTsvDir(resolvePath(process.cwd(), args.from)) : await loadFromSqlite(resolvePath(process.cwd(), args.sqlite))
  }
  catch (err) {
    console.error(`Erreur de lecture des données Roundcube : ${err.message}`)
    process.exitCode = 1
    return
  }
  if (data.responsesWarning) console.log(`! ${data.responsesWarning}`)

  const ownerByUserId = new Map()
  for (const u of data.users) {
    try {
      ownerByUserId.set(String(u.user_id), usernameToEmail(u.username, args.domain))
    }
    catch (err) {
      console.log(`! Utilisateur Roundcube ignoré (user_id=${u.user_id}) : ${err.message}`)
    }
  }

  const onlySet = args.only ? new Set(String(args.only).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) : null

  if (args.apply) {
    console.log('MODE APPLICATION — écriture réelle dans la base Colombe.')
    console.log('Vérifiez que Colombe est ARRÊTÉ (sudo systemctl stop colombe) avant de continuer.')
    const walFile = `${dbFile}-wal`
    if (existsSync(walFile) && statSync(walFile).size > 0) {
      console.log(`! ${walFile} contient des données non archivées : un processus Colombe est peut-être encore actif. Arrêtez-le avant --apply.`)
    }
  }
  else {
    console.log('DRY RUN — aucune écriture (relancez avec --apply pour appliquer).')
  }

  const { openDatabase } = await import('../server/lib/store/db.ts')
  const { parseVCards } = await import('../server/lib/contacts/vcard.ts').catch(() => ({ parseVCards: null }))
  const db = openDatabase(dbFile)

  const rows = []
  for (const [userId, owner] of ownerByUserId) {
    if (onlySet && !onlySet.has(owner)) continue
    db.exec('BEGIN')
    try {
      const stats = importOneUser(db, owner, userId, data, { parseVCards })
      if (args.apply) db.exec('COMMIT')
      else db.exec('ROLLBACK')
      rows.push({
        owner,
        contacts: `+${stats.contacts.created}/${stats.contacts.merged}f/${stats.contacts.skipped}x`,
        groupes: `+${stats.groups.created}/${stats.groups.exists}=`,
        membres: stats.groupMembers,
        identités: `+${stats.identities.created}/${stats.identities.updated}=/${stats.identities.skipped}x`,
        réponses: `+${stats.responses.created}/${stats.responses.updated}=/${stats.responses.skipped}x`,
      })
    }
    catch (err) {
      db.exec('ROLLBACK')
      rows.push({ owner, contacts: 'ERREUR', groupes: '', membres: '', identités: '', réponses: err.message })
    }
  }

  console.log('')
  console.log('Légende : +créés / f=fusionnés / ==existants (mis à jour) / x=ignorés')
  printTable(rows)

  db.close()

  if (!args.apply) console.log('\nDRY RUN terminé — relancez avec --apply pour écrire réellement.')
  else console.log('\nImport appliqué.')
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exitCode = 1
  })
}
