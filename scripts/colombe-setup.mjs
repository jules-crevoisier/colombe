#!/usr/bin/env node
/**
 * colombe-setup — génère un .env fonctionnel pour Colombe en moins de 2 minutes.
 * Interactif par défaut ; entièrement pilotable par flags pour un déploiement scripté.
 * Peut importer les réglages depuis un config.inc.php de Roundcube (--from-roundcube).
 *
 * Zéro dépendance npm (Node 24 built-ins uniquement) : tourne dans l'archive de release,
 * sans pnpm ni node_modules. Voir scripts/lib/self-exec.mjs pour le détail du flag
 * --experimental-transform-types nécessaire à l'import de server/lib/config/index.ts.
 */
import { ensureTypeScriptSupport, isMainModule } from './lib/self-exec.mjs'
if (isMainModule(import.meta.url)) ensureTypeScriptSupport()

import { existsSync, readFileSync, statSync } from 'node:fs'
import { platform } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { createInterface } from 'node:readline/promises'
import process from 'node:process'
import {
  generateSecret,
  readEnvFile,
  redactEnv,
  serializeEnv,
  writeEnvFile,
} from './lib/env-file.mjs'
import { parseRoundcubeMainConfig, parseRoundcubeManagesieveConfig } from './lib/roundcube.mjs'
import { probeImap, probeSieve, probeSmtp } from './lib/probe.mjs'

const HELP = `colombe-setup — génère un .env fonctionnel pour Colombe

Usage :
  node scripts/colombe-setup.mjs [options]

Options :
  --domain <domaine[,domaine...]>   Domaine(s) des adresses (MAIL_DOMAINS). Obligatoire
                                     en non-interactif si --from-roundcube ne le déduit pas.
  --host <hôte>                     Serveur IMAP + SMTP (si identique). Ex. mail.example.org
  --imap-host <hôte>                Serveur IMAP (si différent de --host)
  --imap-port <port>                Port IMAP (défaut 993)
  --smtp-host <hôte>                Serveur SMTP (si différent de --host)
  --smtp-port <port>                Port SMTP (défaut 587)
  --sieve-host <hôte>                Serveur ManageSieve (défaut : même hôte qu'IMAP)
  --sieve-port <port>                Port ManageSieve (défaut 4190)
  --public-host <hôte>              Hôte public à indiquer aux autres logiciels de mail
  --base-path </chemin/>            Chemin de base si Colombe est servi sous un sous-chemin
  --org-name "<nom>"                Nom de l'établissement (COLOMBE_ORG_NAME)
  --support-url <url>               Lien d'aide (COLOMBE_SUPPORT_URL)
  --trust-proxy                     Colombe est derrière un reverse proxy (X-Forwarded-For)
  --data-dir <chemin>                WEBMAIL_DATA_DIR (défaut /var/lib/colombe en root Linux,
                                     sinon ./data)
  --from-roundcube <chemin>         Importe les réglages d'un config.inc.php Roundcube
                                     (fichier, ou dossier le contenant)
  --out <chemin>                    Fichier .env à écrire (défaut .env)
  --force                           Écrase un .env existant (garde une copie .bak)
  --no-probe                        Ne sonde pas les serveurs (pas de connexion réseau)
  --yes                             Non-interactif : n'invite jamais, utilise les valeurs
                                     déduites/fournies ou échoue avec un message clair
  --help                            Affiche cette aide

Étapes suivantes une fois le .env écrit :
  node scripts/colombe-doctor.mjs --env-file <fichier>
  node --env-file=<fichier> server/index.mjs
`

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') { args.help = true; continue }
    if (a === '--yes' || a === '-y') { args.yes = true; continue }
    if (a === '--force') { args.force = true; continue }
    if (a === '--no-probe') { args.noProbe = true; continue }
    if (a === '--trust-proxy') { args.trustProxy = true; continue }
    if (a === '--no-trust-proxy') { args.trustProxy = false; continue }
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[key] = true
      }
      else {
        args[key] = next
        i++
      }
      continue
    }
    args._.push(a)
  }
  return args
}

function camel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function normalizeArgs(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw)) out[camel(k)] = v
  return out
}

// ---------------------------------------------------------------------------
// Invites interactives
// ---------------------------------------------------------------------------

let rl = null
function getRl() {
  rl ??= createInterface({ input: process.stdin, output: process.stdout })
  return rl
}

async function ask(question, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  const answer = (await getRl().question(`${question}${suffix} `)).trim()
  return answer || defaultValue
}

async function confirm(question, defaultValue = false) {
  const suffix = defaultValue ? '[O/n]' : '[o/N]'
  const answer = (await getRl().question(`${question} ${suffix} `)).trim().toLowerCase()
  if (!answer) return defaultValue
  return /^(o|oui|y|yes)$/.test(answer)
}

// ---------------------------------------------------------------------------
// Sortie
// ---------------------------------------------------------------------------

function printTable(rows) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ')
  console.log(line(cols))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(cols.map(c => r[c] ?? '')))
}

function warn(message) {
  console.log(`! ${message}`)
}

function section(title) {
  console.log(`\n${title}`)
  console.log('='.repeat(title.length))
}

// ---------------------------------------------------------------------------
// Import Roundcube
// ---------------------------------------------------------------------------

function resolveRoundcubeConfigPath(input) {
  const abs = resolvePath(process.cwd(), input)
  if (!existsSync(abs)) throw new Error(`--from-roundcube : introuvable (${abs}).`)
  if (statSync(abs).isDirectory()) {
    const candidate = join(abs, 'config.inc.php')
    if (!existsSync(candidate)) throw new Error(`--from-roundcube : ${abs} ne contient pas de config.inc.php.`)
    return candidate
  }
  return abs
}

function findManagesieveConfig(mainConfigPath) {
  const dir = mainConfigPath.replace(/[/\\]config\.inc\.php$/, '')
  const candidates = [
    join(dir, 'plugins', 'managesieve', 'config.inc.php'),
    join(dir, '..', 'plugins', 'managesieve', 'config.inc.php'),
  ]
  return candidates.find(c => existsSync(c)) ?? null
}

async function importFromRoundcube(args) {
  const configPath = resolveRoundcubeConfigPath(args.fromRoundcube)
  const source = readFileSync(configPath, 'utf8')
  const parsed = parseRoundcubeMainConfig(source)

  let sieve = { host: null, port: null, warnings: [] }
  const sievePath = findManagesieveConfig(configPath)
  if (sievePath) {
    sieve = parseRoundcubeManagesieveConfig(readFileSync(sievePath, 'utf8'))
  }

  section(`Import Roundcube (${configPath})`)
  const rows = []
  if (parsed.imap) rows.push({ paramètre: 'IMAP', valeur: parsed.imap.raw, source: parsed.imap.source })
  if (parsed.smtp) rows.push({ paramètre: 'SMTP', valeur: parsed.smtp.raw, source: parsed.smtp.source })
  if (sieve.raw) rows.push({ paramètre: 'ManageSieve', valeur: sieve.raw, source: sievePath })
  if (parsed.usernameDomain) rows.push({ paramètre: 'username_domain', valeur: parsed.usernameDomain, source: 'config.inc.php' })
  if (parsed.mailDomain) rows.push({ paramètre: 'mail_domain', valeur: parsed.mailDomain, source: 'config.inc.php' })
  if (parsed.productName) rows.push({ paramètre: 'product_name', valeur: parsed.productName, source: 'config.inc.php' })
  if (parsed.supportUrl) rows.push({ paramètre: 'support_url', valeur: parsed.supportUrl, source: 'config.inc.php' })
  if (rows.length) printTable(rows)
  else console.log('(rien d\'exploitable trouvé dans ce fichier)')

  const allWarnings = [...parsed.warnings, ...sieve.warnings]
  for (const w of allWarnings) warn(w)

  return { parsed, sieve, warnings: allWarnings }
}

// ---------------------------------------------------------------------------
// Déduction hôte/port/sécurité
// ---------------------------------------------------------------------------

function securityFromHostInfo(hostInfo, implicitPort) {
  if (!hostInfo) return null
  if (hostInfo.scheme === 'ssl') return true
  if (hostInfo.scheme === 'tls' || hostInfo.scheme === 'tcp') return false
  const port = hostInfo.port ?? implicitPort
  return port === implicitPort
}

function isLoopbackHost(host) {
  return /^(localhost|127\.\d+\.\d+\.\d+|::1)$/i.test(host)
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

async function main() {
  const args = normalizeArgs(parseArgs(process.argv.slice(2)))
  if (args.help) { console.log(HELP); return }

  const interactive = !args.yes && process.stdin.isTTY === true
  const outPath = resolvePath(process.cwd(), args.out || '.env')

  let roundcube = null
  if (args.fromRoundcube) {
    try {
      roundcube = await importFromRoundcube(args)
    }
    catch (err) {
      console.error(`Erreur d'import Roundcube : ${err.message}`)
      process.exitCode = 1
      return
    }
  }

  section('Configuration')

  // --- Domaine(s) ---
  let domain = args.domain
  if (!domain && roundcube) domain = roundcube.parsed.mailDomain || roundcube.parsed.usernameDomain || undefined
  if (!domain && interactive) domain = await ask('Domaine des adresses e-mail (ex. univ-exemple.fr)')
  if (!domain) {
    console.error('MAIL_DOMAINS est obligatoire : indiquez --domain <domaine> (ou --from-roundcube pour le déduire).')
    process.exitCode = 1
    return
  }

  // --- IMAP / SMTP ---
  let imapHost = args.imapHost || args.host
  let imapPort = args.imapPort ? Number(args.imapPort) : undefined
  let imapSecure
  if (!imapHost && roundcube?.parsed.imap) {
    let info = roundcube.parsed.imap
    if (info.hasPlaceholder) {
      if (interactive) {
        const real = await ask(`Hôte réel pour IMAP (config Roundcube : « ${info.raw} »)`)
        info = { ...info, host: real, hasPlaceholder: false }
      }
      else {
        console.error(`imap_host contient un espace réservé Roundcube (${info.raw}) : fournissez --imap-host (ou --host) explicitement.`)
        process.exitCode = 1
        return
      }
    }
    imapHost = info.host
    imapPort = info.port ?? undefined
    imapSecure = securityFromHostInfo(info, 993)
  }
  if (!imapHost && interactive) imapHost = await ask('Serveur IMAP (ex. mail.example.org)')
  if (!imapHost) {
    console.error('Serveur IMAP obligatoire : indiquez --host ou --imap-host (ou --from-roundcube).')
    process.exitCode = 1
    return
  }
  imapPort ??= 993
  imapSecure ??= imapPort !== 143

  let smtpHost = args.smtpHost || args.host
  let smtpPort = args.smtpPort ? Number(args.smtpPort) : undefined
  let smtpSecure
  if (!smtpHost && roundcube?.parsed.smtp) {
    let info = roundcube.parsed.smtp
    if (info.hasPlaceholder) {
      if (interactive) {
        const real = await ask(`Hôte réel pour SMTP (config Roundcube : « ${info.raw} »)`)
        info = { ...info, host: real, hasPlaceholder: false }
      }
      else {
        console.error(`smtp_host contient un espace réservé Roundcube (${info.raw}) : fournissez --smtp-host (ou --host) explicitement.`)
        process.exitCode = 1
        return
      }
    }
    smtpHost = info.host
    smtpPort = info.port ?? undefined
    smtpSecure = securityFromHostInfo(info, 465)
  }
  if (!smtpHost) smtpHost = imapHost
  smtpPort ??= 587
  smtpSecure ??= smtpPort === 465

  const sieveHost = args.sieveHost || roundcube?.sieve.host || imapHost
  const sievePort = args.sievePort ? Number(args.sievePort) : (roundcube?.sieve.port ?? 4190)

  // --- Nom d'établissement / support ---
  const orgName = args.orgName || roundcube?.parsed.productName || ''
  const supportUrl = args.supportUrl || roundcube?.parsed.supportUrl || ''

  // --- Chemin de base / reverse proxy ---
  let basePath = args.basePath || ''
  if (basePath && !basePath.startsWith('/')) basePath = `/${basePath}`
  if (basePath && !basePath.endsWith('/')) basePath = `${basePath}/`

  let trustProxy = args.trustProxy
  if (trustProxy === undefined) {
    if (interactive) trustProxy = await confirm('Colombe sera-t-il derrière un reverse proxy (Apache/Nginx) ?', Boolean(basePath))
    else trustProxy = Boolean(basePath)
  }

  // --- Hôte public (si l'hôte interne est en loopback) ---
  let publicHost = args.publicHost || ''
  if (!publicHost && isLoopbackHost(imapHost)) {
    if (interactive) {
      publicHost = await ask('Serveur IMAP/SMTP en localhost détecté : nom public à indiquer aux autres logiciels de mail (vide = aucun)')
    }
    else {
      warn(`MAIL_IMAP_HOST/MAIL_SMTP_HOST est en boucle locale (${imapHost}) : pensez à --public-host si des utilisateurs configurent un autre client de mail.`)
    }
  }

  // --- Dossier de données ---
  const isRootLinux = platform() === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0
  const dataDir = args.dataDir || (isRootLinux ? '/var/lib/colombe' : './data')

  // --- Secrets ---
  const sessionPassword = generateSecret()
  const dataKey = generateSecret()

  const env = {
    NODE_ENV: 'production',
    MAIL_BACKEND: 'imap',
    MAIL_IMAP_HOST: imapHost,
    MAIL_IMAP_PORT: String(imapPort),
    MAIL_IMAP_SECURE: String(imapSecure),
    MAIL_SMTP_HOST: smtpHost,
    MAIL_SMTP_PORT: String(smtpPort),
    MAIL_SMTP_SECURE: String(smtpSecure),
    MAIL_SMTP_REQUIRE_TLS: 'true',
    MAIL_TLS_REJECT_UNAUTHORIZED: 'true',
    MAIL_SIEVE_HOST: sieveHost,
    MAIL_SIEVE_PORT: String(sievePort),
    MAIL_DOMAINS: domain,
    MAIL_FORWARD_DOMAINS: domain,
    MAIL_TRUST_PROXY: String(trustProxy),
    NUXT_SESSION_PASSWORD: sessionPassword,
    WEBMAIL_DATA_KEY: dataKey,
    WEBMAIL_DATA_DIR: dataDir,
  }
  if (basePath) env.NUXT_APP_BASE_URL = basePath
  if (orgName) env.COLOMBE_ORG_NAME = orgName
  if (supportUrl) env.COLOMBE_SUPPORT_URL = supportUrl
  if (publicHost) { env.MAIL_PUBLIC_HOST = publicHost }
  if (isLoopbackHost(imapHost) && !publicHost) {
    env.MAIL_TLS_SERVERNAME = imapHost
    warn('MAIL_TLS_SERVERNAME laissé à ' + imapHost + ' (aucun hôte public fourni) : le certificat TLS doit correspondre à ce nom, ou définissez MAIL_TLS_SERVERNAME manuellement.')
  }

  // --- Sondes réseau ---
  if (!args.noProbe) {
    section('Sondes réseau (5 s max par service)')
    const servername = env.MAIL_TLS_SERVERNAME || imapHost

    const imapProbe = await probeImap({ host: imapHost, port: imapPort, secure: imapSecure, servername })
    reportProbe('IMAP', imapHost, imapPort, imapProbe)

    const smtpProbe = await probeSmtp({ host: smtpHost, port: smtpPort, secure: smtpSecure, servername: env.MAIL_TLS_SERVERNAME || smtpHost })
    reportProbe('SMTP', smtpHost, smtpPort, smtpProbe)

    const sieveProbe = await probeSieve({ host: sieveHost, port: sievePort, servername })
    reportProbe('ManageSieve', sieveHost, sievePort, sieveProbe)
  }
  else {
    console.log('\n(sondes réseau ignorées : --no-probe)')
  }

  // --- Validation via server/lib/config/index.ts (source de vérité) ---
  section('Validation')
  const { loadConfig, ConfigError } = await import('../server/lib/config/index.ts')
  try {
    loadConfig(env, process.cwd())
    console.log('Configuration valide (loadConfig).')
  }
  catch (err) {
    if (err instanceof ConfigError) {
      console.error('Configuration invalide :')
      for (const p of err.problems) console.error(`  - ${p}`)
      process.exitCode = 1
      return
    }
    throw err
  }

  // --- Écriture ---
  const content = serializeEnv({
    'Général': { NODE_ENV: env.NODE_ENV, MAIL_BACKEND: env.MAIL_BACKEND },
    'Serveur mail': {
      MAIL_IMAP_HOST: env.MAIL_IMAP_HOST,
      MAIL_IMAP_PORT: env.MAIL_IMAP_PORT,
      MAIL_IMAP_SECURE: env.MAIL_IMAP_SECURE,
      MAIL_SMTP_HOST: env.MAIL_SMTP_HOST,
      MAIL_SMTP_PORT: env.MAIL_SMTP_PORT,
      MAIL_SMTP_SECURE: env.MAIL_SMTP_SECURE,
      MAIL_SMTP_REQUIRE_TLS: env.MAIL_SMTP_REQUIRE_TLS,
      MAIL_TLS_REJECT_UNAUTHORIZED: env.MAIL_TLS_REJECT_UNAUTHORIZED,
      ...(env.MAIL_TLS_SERVERNAME ? { MAIL_TLS_SERVERNAME: env.MAIL_TLS_SERVERNAME } : {}),
      ...(env.MAIL_PUBLIC_HOST ? { MAIL_PUBLIC_HOST: env.MAIL_PUBLIC_HOST } : {}),
      MAIL_SIEVE_HOST: env.MAIL_SIEVE_HOST,
      MAIL_SIEVE_PORT: env.MAIL_SIEVE_PORT,
    },
    'Comptes': {
      MAIL_DOMAINS: env.MAIL_DOMAINS,
      MAIL_FORWARD_DOMAINS: env.MAIL_FORWARD_DOMAINS,
    },
    'Réseau': {
      MAIL_TRUST_PROXY: env.MAIL_TRUST_PROXY,
      ...(env.NUXT_APP_BASE_URL ? { NUXT_APP_BASE_URL: env.NUXT_APP_BASE_URL } : {}),
    },
    'Identité visuelle': {
      ...(env.COLOMBE_ORG_NAME ? { COLOMBE_ORG_NAME: env.COLOMBE_ORG_NAME } : {}),
      ...(env.COLOMBE_SUPPORT_URL ? { COLOMBE_SUPPORT_URL: env.COLOMBE_SUPPORT_URL } : {}),
    },
    'Secrets (générés — à ne jamais commiter)': {
      NUXT_SESSION_PASSWORD: { value: env.NUXT_SESSION_PASSWORD, comment: 'openssl rand -base64 32 (généré automatiquement)' },
      WEBMAIL_DATA_KEY: { value: env.WEBMAIL_DATA_KEY, comment: 'différente de NUXT_SESSION_PASSWORD (généré automatiquement)' },
    },
    'Stockage local': {
      WEBMAIL_DATA_DIR: env.WEBMAIL_DATA_DIR,
    },
  }, 'Généré par colombe-setup.mjs — voir docs/admin/CONFIGURATION.md')

  try {
    writeEnvFile(outPath, content, { force: Boolean(args.force) })
  }
  catch (err) {
    console.error(err.message)
    process.exitCode = 1
    return
  }

  section('Terminé')
  console.log(`Fichier écrit : ${outPath} (permissions 0600)`)
  console.log('\nRésumé (secrets masqués) :')
  printTable(Object.entries(redactEnv(env)).map(([key, value]) => ({ clé: key, valeur: value })))

  console.log(`
Prochaines étapes :
  1. Vérifier :        node scripts/colombe-doctor.mjs --env-file ${args.out || '.env'}
  2. Démarrer :         node --env-file=${args.out || '.env'} server/index.mjs
  3. Reverse proxy :    voir deploy/ pour un exemple de configuration Apache/Nginx.
  4. Sauvegardez WEBMAIL_DATA_KEY séparément (hors de ce serveur) : sans elle, les
     secrets 2FA déjà stockés deviennent illisibles en cas de perte du .env.
`)

  if (rl) rl.close()
}

function reportProbe(label, host, port, result) {
  if (!result.ok) {
    console.log(`✖ ${label} ${host}:${port} — ${result.error}`)
    return
  }
  const bits = [`✔ ${label} ${host}:${port}`, result.secure ? 'TLS' : 'en clair']
  console.log(bits.join(' — '))
  if (result.cert) {
    const c = result.cert
    const match = c.matchesHostname ? 'correspond' : 'NE CORRESPOND PAS'
    console.log(`    certificat : ${c.subjectCN ?? '?'} (SAN: ${c.altNames.join(', ') || '—'}) — ${match} à ${host}`)
    console.log(`    expire le ${c.validTo} (${c.daysRemaining ?? '?'} j) — ${c.authorized ? 'chaîne de confiance OK' : `NON VALIDÉ (${c.authorizationError})`}`)
    if (!c.matchesHostname) warn(`Le certificat ${label} ne couvre pas « ${host} » : utilisez MAIL_TLS_SERVERNAME si le nom public diffère.`)
  }
  if (result.capabilities) console.log(`    capacités : ${result.capabilities.join(' ')}`)
  if (result.authMechanisms) console.log(`    AUTH : ${result.authMechanisms.join(' ') || '(aucun annoncé)'}`)
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exitCode = 1
  })
}
