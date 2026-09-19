#!/usr/bin/env node
/**
 * colombe-doctor — diagnostic complet d'une installation Colombe : validité de la
 * configuration, version de Node, accès au dossier de données et à SQLite, sondes
 * réseau IMAP/SMTP/ManageSieve, et (avec --user + mot de passe sur stdin) une
 * authentification réelle.
 *
 * Sortie : une ligne ✔/✖/! par vérification. Code de sortie 1 si un ✖ a été émis.
 * Zéro dépendance npm (Node 24 built-ins uniquement).
 */
import { isMainModule } from './lib/self-exec.mjs'

import { existsSync, statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { imapLogin, probeImap, probeSieve, probeSmtp, smtpAuth } from './lib/probe.mjs'

const HELP = `colombe-doctor — diagnostic d'une installation Colombe

Usage :
  node scripts/colombe-doctor.mjs [--env-file .env] [--user x@domaine --password-stdin] [--no-probe]

Options :
  --env-file <chemin>   Fichier d'environnement à charger (défaut .env)
  --user <adresse>      Vérifie aussi les identifiants réels (IMAP LOGIN + SMTP AUTH)
  --password-stdin      Lit le mot de passe sur l'entrée standard (jamais affiché/loggé)
  --no-probe             Ignore les sondes réseau
  --help                 Affiche cette aide

Exemples :
  node scripts/colombe-doctor.mjs
  printf '%s' "$MOT_DE_PASSE" | node scripts/colombe-doctor.mjs --user prenom.nom@example.org --password-stdin
`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') { args.help = true; continue }
    if (a === '--no-probe') { args.noProbe = true; continue }
    if (a === '--password-stdin') { args.passwordStdin = true; continue }
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

let failed = false
function ok(msg) { console.log(`✔ ${msg}`) }
function bad(msg) { failed = true; console.log(`✖ ${msg}`) }
function note(msg) { console.log(`! ${msg}`) }

async function readPasswordFromStdin() {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const pwd = await rl.question('Mot de passe (non affiché) : ')
    rl.close()
    return pwd.trim()
  }
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

const PUBLIC_PROVIDERS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'aol.com', 'protonmail.com', 'proton.me']

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(HELP); return }

  const envFile = resolvePath(process.cwd(), args.envFile || '.env')

  console.log(`Colombe doctor — ${new Date().toISOString()}`)
  console.log(`Fichier d'environnement : ${envFile}\n`)

  // --- Node ---
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major > 22 || (major === 22 && minor >= 13)) {
    ok(`Node ${process.versions.node} (>= 22.13, node:sqlite disponible sans flag)`)
    if (major < 24) note(`Node ${process.versions.node} détecté — Node 24 est recommandé.`)
  }
  else {
    bad(`Node ${process.versions.node} : node:sqlite nécessite au moins Node 22.13 (24 recommandé).`)
  }

  // --- Chargement du .env ---
  if (!existsSync(envFile)) {
    bad(`${envFile} introuvable. Lancez d'abord : node scripts/colombe-setup.mjs --out ${args.envFile || '.env'}`)
    finish()
    return
  }
  try {
    process.loadEnvFile(envFile)
    ok(`${envFile} chargé.`)
  }
  catch (err) {
    bad(`Impossible de charger ${envFile} : ${err.message}`)
    finish()
    return
  }

  // --- Config ---
  const { loadConfig, ConfigError } = await import('../server/lib/config/index.ts')
  let config = null
  try {
    config = loadConfig(process.env, process.cwd())
    ok('Configuration valide (loadConfig).')
  }
  catch (err) {
    if (err instanceof ConfigError) {
      bad(`Configuration invalide (${err.problems.length} problème(s)) :`)
      for (const p of err.problems) console.log(`    - ${p}`)
    }
    else {
      bad(`loadConfig a levé une erreur inattendue : ${err.message}`)
    }
  }

  if (config) {
    if (process.env.NUXT_APP_BASE_URL && !process.env.NUXT_APP_BASE_URL.endsWith('/')) {
      note(`NUXT_APP_BASE_URL (« ${process.env.NUXT_APP_BASE_URL} ») ne se termine pas par un « / ».`)
    }
    if (config.production && !config.trustProxy) {
      note('NODE_ENV=production et MAIL_TRUST_PROXY=false : si Colombe est derrière un reverse proxy, l\'IP client dans les journaux sera fausse (voir docs/admin/configuration.md).')
    }
    const badForward = config.forwardDomains.filter(d => PUBLIC_PROVIDERS.includes(d))
    if (badForward.length) {
      note(`MAIL_FORWARD_DOMAINS autorise ${badForward.join(', ')} : un transfert automatique vers un fournisseur public est un risque d'exfiltration en cas de compte compromis.`)
    }
  }

  // --- Dossier de données + SQLite ---
  if (config) {
    await checkDataDir(config.dataDir)
  }

  // --- Sondes réseau ---
  if (config && !args.noProbe) {
    console.log('\nSondes réseau :')
    const imapProbe = await probeImap({ host: config.imap.host, port: config.imap.port, secure: config.imap.secure, servername: config.imap.servername, rejectUnauthorized: config.tlsRejectUnauthorized })
    reportProbe('imap', config.imap.host, config.imap.port, imapProbe)

    const smtpProbe = await probeSmtp({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, servername: config.smtp.servername, rejectUnauthorized: config.tlsRejectUnauthorized })
    reportProbe('smtp', config.smtp.host, config.smtp.port, smtpProbe)

    if (config.sieve.enabled) {
      const sieveProbe = await probeSieve({ host: config.sieve.host, port: config.sieve.port, servername: config.sieve.servername, rejectUnauthorized: config.tlsRejectUnauthorized })
      reportProbe('sieve', config.sieve.host, config.sieve.port, sieveProbe)
    }
    else {
      note('MAIL_SIEVE_ENABLED=false : filtres/transferts/réponses automatiques désactivés, sonde ManageSieve ignorée.')
    }
  }

  // --- Identifiants réels ---
  if (config && args.user) {
    if (!args.passwordStdin) {
      bad('--user fourni sans --password-stdin : le mot de passe ne peut pas être passé autrement (jamais en argument de ligne de commande).')
    }
    else {
      const password = await readPasswordFromStdin()
      if (!password) {
        bad('Aucun mot de passe reçu sur l\'entrée standard.')
      }
      else {
        console.log(`\nVérification des identifiants pour ${args.user} :`)
        const username = config.login.username === 'localpart' ? args.user.slice(0, args.user.lastIndexOf('@')) : args.user
        const imapRes = await imapLogin({ host: config.imap.host, port: config.imap.port, secure: config.imap.secure, servername: config.imap.servername, rejectUnauthorized: config.tlsRejectUnauthorized }, username, password)
        if (imapRes.ok) ok('IMAP LOGIN accepté.')
        else bad(`IMAP LOGIN refusé : ${imapRes.error}`)

        const smtpRes = await smtpAuth({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, servername: config.smtp.servername, rejectUnauthorized: config.tlsRejectUnauthorized }, username, password)
        if (smtpRes.ok) ok('SMTP AUTH accepté.')
        else bad(`SMTP AUTH refusé : ${smtpRes.error}`)
      }
    }
  }
  else if (args.user && !config) {
    bad('--user ignoré : la configuration est invalide, corrigez-la d\'abord.')
  }

  finish()
}

async function checkDataDir(dataDir) {
  if (!existsSync(dataDir)) {
    bad(`WEBMAIL_DATA_DIR (${dataDir}) n'existe pas.`)
    return
  }
  if (!statSync(dataDir).isDirectory()) {
    bad(`WEBMAIL_DATA_DIR (${dataDir}) n'est pas un dossier.`)
    return
  }
  try {
    const probeFile = resolvePath(dataDir, `.colombe-doctor-${process.pid}`)
    const { writeFileSync, unlinkSync } = await import('node:fs')
    writeFileSync(probeFile, '')
    unlinkSync(probeFile)
    ok(`WEBMAIL_DATA_DIR (${dataDir}) accessible en écriture.`)
  }
  catch (err) {
    bad(`WEBMAIL_DATA_DIR (${dataDir}) : écriture impossible (${err.message}).`)
    return
  }

  const dbFile = resolvePath(dataDir, 'webmail.sqlite')
  if (!existsSync(dbFile)) {
    note(`${dbFile} n'existe pas encore : il sera créé au premier démarrage de Colombe.`)
    return
  }
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const result = db.prepare('PRAGMA integrity_check').get()
    db.close()
    if (result && result.integrity_check === 'ok') ok(`${dbFile} : intégrité SQLite OK.`)
    else bad(`${dbFile} : PRAGMA integrity_check a signalé un problème (${JSON.stringify(result)}).`)
  }
  catch (err) {
    bad(`${dbFile} : impossible de l'ouvrir (${err.message}).`)
  }
}

function reportProbe(label, host, port, result) {
  if (!result.ok) {
    bad(`${label} ${host}:${port} — ${result.error}`)
    return
  }
  ok(`${label} ${host}:${port} (${result.secure ? 'TLS' : 'en clair'})`)
  if (result.cert) {
    const c = result.cert
    if (!c.matchesHostname) note(`${label} : le certificat (${c.subjectCN}, SAN: ${c.altNames.join(', ') || '—'}) ne couvre pas ${host}.`)
    if (c.daysRemaining !== null && c.daysRemaining < 21) note(`${label} : certificat expire dans ${c.daysRemaining} j (${c.validTo}).`)
    if (!c.authorized) note(`${label} : chaîne de certification non validée (${c.authorizationError}).`)
  }
}

function finish() {
  console.log('')
  console.log(failed ? 'Résultat : des problèmes ont été détectés (✖ ci-dessus).' : 'Résultat : aucun problème bloquant détecté.')
  process.exitCode = failed ? 1 : 0
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exitCode = 1
  })
}
