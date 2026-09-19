/**
 * Fonctions pures pour l'import de données Roundcube : parsing de config.inc.php,
 * dé-échappement TSV (exports MySQL/PostgreSQL), correspondance identifiant → adresse,
 * et écriture idempotente dans la base SQLite de Colombe.
 *
 * Zéro dépendance npm (Node 24 built-ins uniquement) : ce module tourne à la fois dans
 * les tests (vitest) et dans l'archive de release, sans node_modules.
 *
 * Toutes les fonctions sont exportées séparément pour être testables unitairement.
 */

// ============================================================================
// Parsing de config.inc.php (Roundcube 1.5/1.6 + héritage 1.4 et antérieur)
// ============================================================================

/**
 * Retire les commentaires PHP (`//`, `#`, `/* *\/`) en respectant les chaînes ('...'/"...")
 * — indispensable car les URI comme 'ssl://host:993' contiennent `//`, qui ne doit
 * jamais être confondu avec un commentaire.
 */
export function stripPhpComments(source) {
  let out = ''
  let i = 0
  let quote = null
  while (i < source.length) {
    const c = source[i]
    if (quote) {
      out += c
      if (c === '\\') {
        out += source[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '\'' || c === '"') {
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Isole le texte du membre droit (RHS) de la DERNIÈRE affectation
 * `$config['key'] = ...;` dans le source (déjà nettoyé de ses commentaires) : PHP exécute
 * les instructions dans l'ordre, une redéfinition plus bas écrase la précédente.
 * Respecte les chaînes et la profondeur de parenthèses/crochets pour trouver le `;` final.
 */
export function extractPhpAssignment(cleanedSource, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\$config\\s*\\[\\s*['"]${escaped}['"]\\s*\\]\\s*=(?!=)`, 'g')
  let match
  let last = null
  while ((match = re.exec(cleanedSource))) last = match
  if (!last) return undefined

  let i = last.index + last[0].length
  let depth = 0
  let quote = null
  const start = i
  while (i < cleanedSource.length) {
    const c = cleanedSource[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '\'' || c === '"') { quote = c; i++; continue }
    if (c === '(' || c === '[') { depth++; i++; continue }
    if (c === ')' || c === ']') { depth--; i++; continue }
    if (c === ';' && depth === 0) return cleanedSource.slice(start, i).trim()
    i++
  }
  return cleanedSource.slice(start).trim()
}

/**
 * Parse une valeur littérale PHP simple : chaîne, nombre, booléen, null, `array(...)` ou
 * `[...]` (indexé ou associatif, imbriqué). Suffisant pour les valeurs de configuration
 * Roundcube ; ne prétend pas être un parseur PHP complet.
 */
export function parsePhpLiteral(raw) {
  const s = raw.trim()
  let i = 0

  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++
  }

  function parseString() {
    const quote = s[i]
    i++
    let out = ''
    while (i < s.length && s[i] !== quote) {
      if (s[i] === '\\') {
        const next = s[i + 1]
        if (quote === '\'') {
          if (next === '\\' || next === '\'') { out += next; i += 2; continue }
          out += s[i]; i++; continue
        }
        const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', $: '$' }
        if (next !== undefined && next in map) { out += map[next]; i += 2; continue }
        out += s[i]; i++; continue
      }
      out += s[i]
      i++
    }
    i++ // guillemet fermant
    return out
  }

  function parseScalarToken(tok) {
    const t = tok.trim()
    if (/^true$/i.test(t)) return true
    if (/^false$/i.test(t)) return false
    if (/^null$/i.test(t)) return null
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
    return t
  }

  function parseArrayBody(closeChar) {
    const items = []
    const obj = {}
    let isAssoc = false
    skipWs()
    while (i < s.length && s[i] !== closeChar) {
      skipWs()
      const first = parseValue()
      skipWs()
      if (s.slice(i, i + 2) === '=>') {
        i += 2
        const val = parseValue()
        obj[String(first)] = val
        isAssoc = true
      }
      else {
        items.push(first)
      }
      skipWs()
      if (s[i] === ',') { i++; skipWs() }
    }
    if (s[i] === closeChar) i++
    return isAssoc ? obj : items
  }

  function parseValue() {
    skipWs()
    if (s[i] === '\'' || s[i] === '"') return parseString()
    if (/^array\s*\(/i.test(s.slice(i))) {
      const m = /^array\s*\(/i.exec(s.slice(i))
      i += m[0].length
      return parseArrayBody(')')
    }
    if (s[i] === '[') { i++; return parseArrayBody(']') }
    const m = /^[^,()[\]]+/.exec(s.slice(i))
    const tok = m ? m[0] : s.slice(i)
    i += tok.length
    return parseScalarToken(tok)
  }

  if (!s) return undefined
  return parseValue()
}

/** Lit et parse une clé `$config['key']` du source déjà nettoyé de ses commentaires. */
function readKey(cleanedSource, key) {
  const raw = extractPhpAssignment(cleanedSource, key)
  return raw === undefined ? undefined : parsePhpLiteral(raw)
}

/** `ssl://host:993`, `tls://host:587`, `localhost:25`, ou `host` nu. */
export function parseHostUri(raw) {
  let scheme = null
  let rest = raw
  const schemeMatch = /^(ssl|tls|tcp):\/\/(.+)$/i.exec(raw)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    rest = schemeMatch[2]
  }
  let host = rest
  let port = null
  const portMatch = /^(.*):(\d+)$/.exec(rest)
  if (portMatch) {
    host = portMatch[1]
    port = Number(portMatch[2])
  }
  host = host.replace(/^\[/, '').replace(/\]$/, '')
  return { scheme, host, port }
}

const PLACEHOLDER_RE = /%[ntds]\b/i

/** Recherche récursive d'un `verify_peer`/`verify_peer_name` à `false` dans une structure imbriquée. */
export function hasVerifyPeerFalse(value) {
  if (value === false) return false // valeur scalaire seule : rien à inspecter ici
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/^verify_peer(_name)?$/i.test(k) && v === false) return true
      if (hasVerifyPeerFalse(v)) return true
    }
  }
  return false
}

function firstArrayOrObjectValue(value) {
  if (Array.isArray(value)) return value[0]
  if (value && typeof value === 'object') return Object.values(value)[0]
  return value
}

/**
 * Parse le config.inc.php principal de Roundcube et retourne une suggestion de
 * configuration Colombe + les avertissements à afficher à l'admin.
 */
export function parseRoundcubeMainConfig(source) {
  const clean = stripPhpComments(source)
  const warnings = []
  const get = key => readKey(clean, key)

  function resolveHost(primaryKey, legacyKey, legacyPortKey) {
    let value = get(primaryKey)
    let sourceKey = primaryKey
    if (value === undefined && legacyKey) {
      value = get(legacyKey)
      sourceKey = `${legacyKey} (ancien style)`
    }
    if (value === undefined) return null

    if (Array.isArray(value) || (value && typeof value === 'object')) {
      const first = firstArrayOrObjectValue(value)
      warnings.push(`${sourceKey} est un tableau (multi-hôtes ou routage par domaine) : la première valeur a été retenue (${JSON.stringify(first)}). Vérifiez qu'elle convient à votre établissement.`)
      value = first
    }

    if (typeof value !== 'string') return null
    if (PLACEHOLDER_RE.test(value)) {
      warnings.push(`${sourceKey} contient un espace réservé Roundcube (${value}) — remplacé par login/domaine selon l'utilisateur. Indiquez l'hôte réel avec --host (ou répondez à la question posée).`)
    }

    const parsed = parseHostUri(value)
    if (parsed.port === null && legacyPortKey) {
      const legacyPort = get(legacyPortKey)
      if (typeof legacyPort === 'number') parsed.port = legacyPort
    }
    return { ...parsed, source: sourceKey, raw: value, hasPlaceholder: PLACEHOLDER_RE.test(value) }
  }

  const imap = resolveHost('imap_host', 'default_host', 'default_port')
  const smtp = resolveHost('smtp_host', 'smtp_server', 'smtp_port')

  const imapConnOptions = get('imap_conn_options')
  const smtpConnOptions = get('smtp_conn_options')
  if (hasVerifyPeerFalse(imapConnOptions)) warnings.push('imap_conn_options désactive la vérification du certificat (verify_peer=false) : Colombe refuse ceci en production.')
  if (hasVerifyPeerFalse(smtpConnOptions)) warnings.push('smtp_conn_options désactive la vérification du certificat (verify_peer=false) : Colombe refuse ceci en production.')

  let usernameDomain = get('username_domain')
  if (usernameDomain && typeof usernameDomain === 'object' && !Array.isArray(usernameDomain)) {
    const first = Object.values(usernameDomain)[0]
    warnings.push(`username_domain est associatif (par hôte IMAP) : la première valeur a été retenue (${JSON.stringify(first)}).`)
    usernameDomain = first
  }
  if (Array.isArray(usernameDomain)) usernameDomain = usernameDomain[0]

  const mailDomain = get('mail_domain')
  const productName = get('product_name')
  const supportUrl = get('support_url')

  return {
    imap,
    smtp,
    usernameDomain: typeof usernameDomain === 'string' ? usernameDomain : null,
    mailDomain: typeof mailDomain === 'string' ? mailDomain : null,
    productName: typeof productName === 'string' ? productName : null,
    supportUrl: typeof supportUrl === 'string' ? supportUrl : null,
    warnings,
  }
}

/** Parse le config.inc.php du plugin managesieve (souvent à côté du config principal). */
export function parseRoundcubeManagesieveConfig(source) {
  const clean = stripPhpComments(source)
  const get = key => readKey(clean, key)
  let host = get('managesieve_host')
  const warnings = []
  if (Array.isArray(host)) { warnings.push(`managesieve_host est un tableau : la première valeur a été retenue.`); host = host[0] }
  const port = get('managesieve_port')
  if (typeof host !== 'string') return { host: null, port: typeof port === 'number' ? port : null, warnings }
  const parsed = parseHostUri(host)
  if (parsed.port === null && typeof port === 'number') parsed.port = port
  return { ...parsed, raw: host, warnings }
}

// ============================================================================
// TSV (exports mysql.sh / postgres.sh) — même échappement (style MySQL --batch / Postgres
// COPY text) : \N = NULL, \\ \t \n \r échappés.
// ============================================================================

/** Dé-échappe un champ TSV façon `mysql --batch` / `COPY ... TEXT` : renvoie `null` pour `\N`. */
export function unescapeTsvField(field) {
  if (field === '\\N') return null
  let out = ''
  for (let i = 0; i < field.length; i++) {
    if (field[i] === '\\' && i + 1 < field.length) {
      const next = field[i + 1]
      const map = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', b: '\b', f: '\f', v: '\v' }
      if (next in map) { out += map[next]; i++; continue }
      out += next
      i++
      continue
    }
    out += field[i]
  }
  return out
}

/** Parse un contenu TSV brut en tableau de lignes de champs (chaîne | null). */
export function parseTsvContent(content) {
  const text = content.replace(/^﻿/, '')
  const lines = text.split(/\r?\n/)
  const rows = []
  for (const line of lines) {
    if (line === '') continue
    rows.push(line.split('\t').map(unescapeTsvField))
  }
  return rows
}

/** Parse un TSV en tableau d'objets, à partir d'une liste de noms de colonnes (ordre du SELECT). */
export function parseTsvTable(content, columns) {
  return parseTsvContent(content).map((fields) => {
    const row = {}
    columns.forEach((col, idx) => { row[col] = fields[idx] ?? null })
    return row
  })
}

// ============================================================================
// Identifiant Roundcube → adresse e-mail Colombe
// ============================================================================

/**
 * `username` Roundcube → adresse e-mail Colombe (clé `owner`), toujours en minuscules.
 * Si `username` ne contient pas de `@`, `domain` est obligatoire (sinon erreur).
 */
export function usernameToEmail(username, domain) {
  const u = String(username).trim().toLowerCase()
  if (!u) throw new Error('Identifiant Roundcube vide.')
  if (u.includes('@')) return u
  if (!domain) throw new Error(`Identifiant Roundcube « ${username} » sans @ et --domain non fourni.`)
  return `${u}@${domain.toLowerCase()}`
}

// ============================================================================
// HTML minimal (signatures / réponses types importées) — pas de dépendance DOMPurify
// (contrainte "zéro dépendance" des CLI) : liste blanche stricte inspirée de
// server/lib/mail/sanitize-outgoing.ts, appliquée par une passe regex simple.
// Best-effort : un import ponctuel exécuté par un admin, pas un filtre exposé à un
// attaquant distant ; documenté comme limitation dans le rapport.
// ============================================================================

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'pre', 'code', 'hr', 'span', 'div'])
const SAFE_IMAGE_DATA_URI = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+=*$/i

/** Échappe un texte brut en HTML (entités) — utilisé pour les signatures/réponses en texte simple. */
export function escapePlainText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convertit un texte brut (signature/réponse Roundcube non-HTML) en HTML avec `<br>`. */
export function textToHtml(text) {
  return escapePlainText(String(text)).replace(/\r\n|\r|\n/g, '<br>\n')
}

/**
 * Filtre HTML minimal (liste blanche, sans arbre DOM) : retire `<script>`/`<style>`,
 * les gestionnaires d'événements `on*`, les URLs `javascript:`, et toute balise hors
 * liste blanche (la balise est supprimée, son contenu texte est conservé). Les images
 * ne sont conservées que si leur `src` est un `data:image/(png|jpeg|gif);base64,…`
 * (jamais de source distante), comme le fait server/lib/mail/sanitize-outgoing.ts.
 */
export function sanitizeImportedHtml(html) {
  if (!html) return ''
  let out = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)>/g, (full, closing, tagRaw, attrsRaw) => {
    const tag = tagRaw.toLowerCase()

    if (tag === 'img' && !closing) {
      const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw)
      const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : ''
      if (SAFE_IMAGE_DATA_URI.test(src)) return `<img src="${src}" alt="">`
      return ''
    }

    if (!ALLOWED_TAGS.has(tag)) return ''

    if (closing) return `</${tag}>`

    let attrs = ''
    if (tag === 'a') {
      const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw)
      const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '') : ''
      if (/^(https?:|mailto:)/i.test(href)) attrs = ` href="${href.replace(/"/g, '&quot;')}" rel="noopener noreferrer"`
    }
    return `<${tag}${attrs}>`
  })

  // Ceinture et bretelles : neutralise tout attribut on*=, javascript: ou data: (hors image) résiduel.
  out = out.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/javascript:/gi, '')

  return out.trim()
}

// ============================================================================
// Import idempotent dans la base SQLite de Colombe — logique répliquée depuis
// server/lib/store/{contacts,contact-groups,identities,responses}.ts (schéma exact,
// mêmes règles de correspondance), en SQL direct pour rester sans dépendance npm.
// ============================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clamp(value, max) {
  const s = String(value ?? '')
  return s.length > max ? s.slice(0, max) : s
}

/** Réplique server/lib/store/contacts.ts#findContactIdByAnyEmail : adresse principale OU secondaire. */
function findContactIdByAnyEmail(db, owner, email) {
  const row = db
    .prepare(
      `SELECT c.id FROM contacts c WHERE c.owner = ? AND c.email = ?
       UNION
       SELECT c.id FROM contacts c JOIN contact_emails ce ON ce.contact_id = c.id WHERE c.owner = ? AND ce.address = ?
       LIMIT 1`
    )
    .get(owner, email, owner, email)
  return row ? row.id : null
}

function getContactDetailsRaw(db, id) {
  const row = db.prepare('SELECT details FROM contacts WHERE id = ?').get(id)
  try {
    return JSON.parse(row?.details || '{}')
  }
  catch {
    return {}
  }
}

function getContactEmails(db, id) {
  const rows = db.prepare('SELECT label, address FROM contact_emails WHERE contact_id = ? ORDER BY position').all(id)
  return rows.map(r => ({ label: r.label, address: r.address }))
}

/** Remplace la fiche complète (details JSON + contact_emails), comme updateContactDetail(). */
function writeContactDetail(db, id, { name, primaryEmail, details, emails }) {
  db.prepare('UPDATE contacts SET email = ?, name = ?, details = ? WHERE id = ?').run(primaryEmail, name, JSON.stringify(details), id)
  db.prepare('DELETE FROM contact_emails WHERE contact_id = ?').run(id)
  const insert = db.prepare('INSERT INTO contact_emails (contact_id, position, label, address) VALUES (?, ?, ?, ?)')
  emails.forEach((e, index) => insert.run(id, index, e.label, e.address))
}

/**
 * @typedef {object} ImportContactRecord
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} displayName
 * @property {Array<{label: string, address: string}>} emails
 * @property {Array<{label: string, number: string}>} phones
 * @property {string} organization
 * @property {string} jobTitle
 * @property {string|null} birthday
 * @property {string} notes
 */

/**
 * Importe un contact (fusion si une adresse — principale ou secondaire — correspond déjà
 * à une fiche du propriétaire, comme server/lib/store/contacts.ts#mergeImportedContact) :
 * complète les champs vides, ne remplace jamais un champ déjà renseigné.
 * Retourne 'created' | 'merged' | 'skipped' (aucune adresse valide).
 */
export function applyContactImport(db, owner, record) {
  const emails = (record.emails ?? [])
    .map(e => ({ label: e.label ?? 'other', address: String(e.address ?? '').trim().toLowerCase() }))
    .filter(e => EMAIL_RE.test(e.address))
  if (!emails.length) return { status: 'skipped', reason: 'aucune adresse e-mail valide' }

  const displayName = clamp(record.displayName?.trim() || `${record.firstName ?? ''} ${record.lastName ?? ''}`.trim(), 200)

  let contactId = null
  for (const e of emails) {
    contactId = findContactIdByAnyEmail(db, owner, e.address)
    if (contactId) break
  }

  if (contactId) {
    const existing = getContactDetailsRaw(db, contactId)
    const existingEmails = getContactEmails(db, contactId)
    const mergedEmails = [...existingEmails]
    for (const e of emails) if (!mergedEmails.some(m => m.address === e.address)) mergedEmails.push(e)

    const details = {
      firstName: existing.firstName || clamp(record.firstName ?? '', 100),
      lastName: existing.lastName || clamp(record.lastName ?? '', 100),
      displayName: existing.displayName || displayName,
      phones: (existing.phones?.length ? existing.phones : record.phones ?? []).map(p => ({ label: p.label ?? 'other', number: clamp(p.number, 50) })),
      organization: existing.organization || clamp(record.organization ?? '', 200),
      jobTitle: existing.jobTitle || clamp(record.jobTitle ?? '', 200),
      address: existing.address ?? null,
      birthday: existing.birthday || record.birthday || null,
      notes: existing.notes || clamp(record.notes ?? '', 5000),
    }
    const nameRow = db.prepare('SELECT name FROM contacts WHERE id = ?').get(contactId)
    writeContactDetail(db, contactId, {
      name: nameRow?.name || details.displayName,
      primaryEmail: mergedEmails[0].address,
      details,
      emails: mergedEmails,
    })
    db.prepare('UPDATE contacts SET manual = 1 WHERE id = ?').run(contactId)
    return { status: 'merged', id: contactId }
  }

  const primary = emails[0]
  db.prepare('INSERT INTO contacts (owner, email, name, manual, times_contacted, last_contacted_at) VALUES (?, ?, ?, 1, 0, NULL)')
    .run(owner, primary.address, displayName)
  const created = db.prepare('SELECT id FROM contacts WHERE owner = ? AND email = ?').get(owner, primary.address)
  const details = {
    firstName: clamp(record.firstName ?? '', 100),
    lastName: clamp(record.lastName ?? '', 100),
    displayName: clamp(record.displayName ?? '', 200),
    phones: (record.phones ?? []).map(p => ({ label: p.label ?? 'other', number: clamp(p.number, 50) })),
    organization: clamp(record.organization ?? '', 200),
    jobTitle: clamp(record.jobTitle ?? '', 200),
    address: null,
    birthday: record.birthday ?? null,
    notes: clamp(record.notes ?? '', 5000),
  }
  writeContactDetail(db, created.id, { name: displayName, primaryEmail: primary.address, details, emails })
  return { status: 'created', id: created.id }
}

/** Groupe : correspondance owner+name (UNIQUE en base), comme contact-groups.ts#createGroup. */
export function applyGroupImport(db, owner, name) {
  const trimmed = clamp(String(name ?? '').trim(), 100)
  if (!trimmed) return { status: 'skipped', reason: 'nom de groupe vide' }
  const existing = db.prepare('SELECT id FROM contact_groups WHERE owner = ? AND name = ?').get(owner, trimmed)
  if (existing) return { status: 'exists', id: existing.id }
  db.prepare('INSERT INTO contact_groups (owner, name, created_at) VALUES (?, ?, ?)').run(owner, trimmed, new Date().toISOString())
  const created = db.prepare('SELECT id FROM contact_groups WHERE owner = ? AND name = ?').get(owner, trimmed)
  return { status: 'created', id: created.id }
}

/** Idempotent : INSERT OR IGNORE sur la clé primaire (group_id, contact_id). */
export function applyGroupMember(db, groupId, contactId) {
  db.prepare('INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)').run(groupId, contactId)
}

/**
 * Identité : Colombe n'a pas de champ e-mail par identité (`Identity.email` vaut toujours
 * l'adresse de connexion — voir shared/types/mail.ts). Contrairement à Roundcube, qui
 * autorise une adresse différente (alias) par identité. Limitation documentée : la
 * correspondance idempotente utilise owner+name ; si `record.email` (Roundcube) diffère
 * du compte et qu'aucun "reply-to" n'est déjà défini, on le reprend comme repli.
 */
export function applyIdentityImport(db, owner, record) {
  const name = clamp(String(record.name ?? '').trim() || owner.split('@')[0], 200)
  let replyTo = clamp(String(record.replyTo ?? '').trim(), 320)
  const recordEmail = String(record.email ?? '').trim().toLowerCase()
  if (!replyTo && recordEmail && recordEmail !== owner.toLowerCase() && EMAIL_RE.test(recordEmail)) {
    replyTo = recordEmail
  }
  const bcc = clamp(String(record.bcc ?? '').trim(), 320)
  const organization = clamp(String(record.organization ?? '').trim(), 200)
  const signatureHtml = record.htmlSignature ? sanitizeImportedHtml(record.signature ?? '') : textToHtml(record.signature ?? '')

  const existing = db.prepare('SELECT id, is_default FROM identities WHERE owner = ? AND name = ?').get(owner, name)
  const count = db.prepare('SELECT COUNT(*) AS n FROM identities WHERE owner = ?').get(owner).n

  if (existing) {
    db.prepare('UPDATE identities SET reply_to = ?, bcc = ?, organization = ?, signature_html = ? WHERE id = ?')
      .run(replyTo, bcc, organization, signatureHtml, existing.id)
    return { status: 'exists', id: existing.id }
  }

  if (count >= 20) return { status: 'skipped', reason: 'limite de 20 identités atteinte' }

  const makeDefault = count === 0 || (record.standard === true && db.prepare('SELECT COUNT(*) AS n FROM identities WHERE owner = ? AND is_default = 1').get(owner).n === 0)
  if (makeDefault) db.prepare('UPDATE identities SET is_default = 0 WHERE owner = ?').run(owner)
  db.prepare(
    `INSERT INTO identities (owner, name, reply_to, bcc, organization, signature_html, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(owner, name, replyTo, bcc, organization, signatureHtml, makeDefault ? 1 : 0, new Date().toISOString())
  const created = db.prepare('SELECT id FROM identities WHERE owner = ? ORDER BY id DESC LIMIT 1').get(owner)
  return { status: 'created', id: created.id }
}

/** Réponse type : correspondance owner+name, comme responses.ts, MAX_RESPONSES = 100. */
export function applyResponseImport(db, owner, record) {
  const name = clamp(String(record.name ?? '').trim(), 100)
  if (!name) return { status: 'skipped', reason: 'nom de réponse vide' }
  const html = record.isHtml ? sanitizeImportedHtml(record.data ?? '') : textToHtml(record.data ?? '')

  const existing = db.prepare('SELECT id FROM responses WHERE owner = ? AND name = ?').get(owner, name)
  if (existing) {
    db.prepare('UPDATE responses SET html = ? WHERE id = ?').run(html, existing.id)
    return { status: 'exists', id: existing.id }
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM responses WHERE owner = ?').get(owner).n
  if (count >= 100) return { status: 'skipped', reason: 'limite de 100 réponses types atteinte' }
  db.prepare('INSERT INTO responses (owner, name, html, created_at) VALUES (?, ?, ?, ?)').run(owner, name, html, new Date().toISOString())
  const created = db.prepare('SELECT id FROM responses WHERE owner = ? ORDER BY id DESC LIMIT 1').get(owner)
  return { status: 'created', id: created.id }
}
