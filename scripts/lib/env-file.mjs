/**
 * Lecture/écriture de fichiers .env — utilisé par colombe-setup.mjs. Zéro dépendance.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

/** Génère un secret aléatoire adapté à NUXT_SESSION_PASSWORD / WEBMAIL_DATA_KEY (>= 32 caractères). */
export function generateSecret() {
  return randomBytes(32).toString('base64')
}

/** Échappe une valeur pour une ligne KEY=VALUE de .env (guillemets si espace/caractère spécial). */
function formatValue(value) {
  const v = String(value)
  if (v === '') return ''
  if (/^[A-Za-z0-9_./:@%+,=~-]+$/.test(v)) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Sérialise un objet ordonné de groupes { titre: { CLE: valeur } } en contenu .env commenté,
 * dans le style de .env.example.
 */
export function serializeEnv(groups, header = '') {
  const lines = []
  if (header) {
    for (const l of header.split('\n')) lines.push(l ? `# ${l}` : '#')
    lines.push('')
  }
  for (const [title, vars] of Object.entries(groups)) {
    lines.push(`# --- ${title} ---`)
    for (const [key, value] of Object.entries(vars)) {
      if (value && typeof value === 'object' && 'comment' in value) {
        if (value.comment) lines.push(`# ${value.comment}`)
        lines.push(`${key}=${formatValue(value.value ?? '')}`)
      }
      else {
        lines.push(`${key}=${formatValue(value)}`)
      }
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** Parse un fichier .env existant en objet plat { CLE: valeur }. Ignore commentaires et lignes vides. */
export function parseEnvContent(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    env[key] = value
  }
  return env
}

export function readEnvFile(path) {
  if (!existsSync(path)) return null
  return parseEnvContent(readFileSync(path, 'utf8'))
}

/**
 * Écrit le fichier .env avec les permissions 0600 (chmod est un no-op sous Windows, sans
 * effet indésirable). Refuse d'écraser un fichier existant sans `force` ; garde un `.bak`
 * lors d'un écrasement.
 */
export function writeEnvFile(path, content, { force = false } = {}) {
  if (existsSync(path)) {
    if (!force) {
      throw new Error(`${path} existe déjà. Utilisez --force pour l'écraser (une copie .bak sera conservée).`)
    }
    copyFileSync(path, `${path}.bak`)
  }
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  }
  catch {
    // Windows : chmod est un no-op, ignoré.
  }
}

/** Redacte les valeurs secrètes pour l'affichage (--from-roundcube summaries, logs, etc.). */
export function redactEnv(env, secretKeys = ['NUXT_SESSION_PASSWORD', 'WEBMAIL_DATA_KEY']) {
  const out = { ...env }
  for (const k of secretKeys) {
    if (out[k]) out[k] = `${out[k].slice(0, 4)}…(${out[k].length} car.)`
  }
  return out
}
