#!/usr/bin/env node
// Construit l'archive de release de Colombe : `.output/` d'un build propre
// (aucune variable MAIL_*/NUXT_*/WEBMAIL_*/COLOMBE_* de l'environnement de
// développement, aucun `.env` lu), les scripts d'administration, les fichiers
// de déploiement (deploy/), la documentation admin/guide, puis
// release/colombe-<version>.tar.gz + release/SHA256SUMS.
//
// Usage : pnpm release   (ou : node scripts/build-release.mjs)
//
// Aucune dépendance npm : uniquement les modules intégrés à Node.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cd = (...p) => join(root, ...p)

function log(msg) {
  process.stdout.write(`[build-release] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[build-release] ERREUR : ${msg}\n`)
  process.exit(1)
}

// --- Version ---
const pkg = JSON.parse(readFileSync(cd('package.json'), 'utf8'))
const version = pkg.version
if (!version) fail('package.json ne définit pas de "version".')
const releaseName = `colombe-${version}`
const releaseRoot = cd('release')
const releaseDir = join(releaseRoot, releaseName)

log(`Version ${version}`)

// --- 1. Build propre : environnement strippé, .env jamais lu ---
// Un `.env` de développement sur ce poste ne doit jamais influencer le build
// (une seule archive doit servir n'importe quel établissement, configuré au
// démarrage — voir server/lib/config/index.ts). On force donc `nuxt build`
// à charger un fichier .env vide plutôt que le vrai (--dotenv), en plus de
// retirer du processus enfant toute variable MAIL_*/NUXT_*/WEBMAIL_*/COLOMBE_*
// héritée du shell courant.
const strippedPrefixes = ['MAIL_', 'NUXT_', 'WEBMAIL_', 'COLOMBE_']
const buildEnv = {}
for (const [k, v] of Object.entries(process.env)) {
  if (strippedPrefixes.some(p => k.startsWith(p))) continue
  buildEnv[k] = v
}
buildEnv.NODE_ENV = 'production'

const emptyEnvDir = mkdtempSync(join(tmpdir(), 'colombe-release-'))
const emptyEnvFile = join(emptyEnvDir, '.env.empty')
writeFileSync(emptyEnvFile, '')

log('Build Nuxt (environnement nettoyé, sans .env)…')
rmSync(cd('.output'), { recursive: true, force: true })
const build = spawnSync(
  `node scripts/with-build-lock.mjs "pnpm exec nuxt build --dotenv ${JSON.stringify(emptyEnvFile)}"`,
  { cwd: root, env: buildEnv, stdio: 'inherit', shell: true },
)
rmSync(emptyEnvDir, { recursive: true, force: true })
if (build.status !== 0) fail(`nuxt build a échoué (code ${build.status}).`)
if (!existsSync(cd('.output', 'server', 'index.mjs'))) fail('.output/server/index.mjs est introuvable après le build.')

// --- 2. Assemblage du dossier de release ---
log(`Assemblage de release/${releaseName}/…`)
rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

// Sortie Nuxt : server/, public/, nitro.json… directement à la racine de la
// release (comme dans l'image Docker : CMD ["node", "server/index.mjs"]).
cpSync(cd('.output'), releaseDir, { recursive: true })

// Scripts d'administration : copie tolérante (certains sont écrits par
// ailleurs et peuvent ne pas encore exister), en excluant les outils réservés
// au poste de développement.
const devOnlyScripts = new Set(['with-build-lock.mjs', 'deploy.sh', 'check-deploy-secrets.mjs', 'build-release.mjs'])
const scriptsSrc = cd('scripts')
const scriptsDest = join(releaseDir, 'scripts')
if (existsSync(scriptsSrc)) {
  mkdirSync(scriptsDest, { recursive: true })
  for (const entry of readdirSync(scriptsSrc)) {
    if (devOnlyScripts.has(entry)) continue
    cpSync(join(scriptsSrc, entry), join(scriptsDest, entry), { recursive: true })
  }
}

// Les scripts d'administration importent la configuration runtime directement
// en TypeScript (Node 24 l'exécute nativement, sans étape de compilation) :
// le fichier source doit être présent au même chemin relatif.
// (import-roundcube utilise aussi le schéma de la base et le lecteur vCard.)
for (const rel of ['server/lib/config/index.ts', 'server/lib/store/db.ts', 'server/lib/contacts/vcard.ts']) {
  const src = cd(...rel.split('/'))
  if (!existsSync(src)) fail(`${rel} est introuvable.`)
  mkdirSync(join(releaseDir, dirname(rel)), { recursive: true })
  cpSync(src, join(releaseDir, rel))
}

// Déploiement (Docker, systemd, Apache, Nginx, fail2ban).
cpSync(cd('deploy'), join(releaseDir, 'deploy'), { recursive: true })

// Documentation destinée à l'administrateur, si déjà écrite.
for (const dir of ['admin', 'guide']) {
  const src = cd('docs', dir)
  if (existsSync(src)) cpSync(src, join(releaseDir, 'docs', dir), { recursive: true })
}

// Fichiers racine.
cpSync(cd('.env.example'), join(releaseDir, '.env.example'))
cpSync(cd('README.md'), join(releaseDir, 'README.md'))
if (existsSync(cd('CHANGELOG.md'))) cpSync(cd('CHANGELOG.md'), join(releaseDir, 'CHANGELOG.md'))
if (existsSync(cd('SECURITY.md'))) cpSync(cd('SECURITY.md'), join(releaseDir, 'SECURITY.md'))
for (const entry of readdirSync(root)) {
  if (/^LICEN[CS]E/i.test(entry)) cpSync(cd(entry), join(releaseDir, entry))
}
writeFileSync(join(releaseDir, 'VERSION'), `${version}\n`)

// --- 3. Vérifications de sécurité avant de packager ---
log('Vérification : aucun secret ni fichier interdit dans la release…')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}
const files = walk(releaseDir)

// 3a. Secrets du .env de développement (s'il existe sur ce poste).
let secretHits = 0
const envFile = cd('.env')
if (existsSync(envFile)) {
  const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  const secrets = ['NUXT_SESSION_PASSWORD', 'WEBMAIL_DATA_KEY'].map(k => [k, env[k]]).filter(([, v]) => v && v.length >= 8)
  for (const f of files) {
    const content = readFileSync(f, 'latin1')
    for (const [k, v] of secrets) {
      if (content.includes(v)) {
        process.stderr.write(`[build-release] FUITE ${k} dans ${relative(root, f)}\n`)
        secretHits++
      }
    }
  }
}
else {
  log('Pas de .env sur ce poste : vérification des secrets ignorée.')
}

// 3b. Backend mémoire (démo) figé en valeur par défaut.
let mockHits = 0
for (const f of files) {
  const content = readFileSync(f, 'latin1')
  if (/backend:\s*["']mock["']/.test(content)) {
    process.stderr.write(`[build-release] backend "mock" en dur dans ${relative(root, f)}\n`)
    mockHits++
  }
}

// 3c. Filet de sécurité : documents internes qui ne doivent jamais quitter le dépôt.
const forbiddenNamePatterns = [/^incident/i, /^SERVEUR\.md$/, /^DEPLOIEMENT\.md$/, /^PLAN/i, /^AUDIT/i]
let forbiddenHits = 0
for (const f of files) {
  const name = basename(f)
  if (name === '.env' || forbiddenNamePatterns.some(re => re.test(name))) {
    process.stderr.write(`[build-release] fichier interdit dans la release : ${relative(root, f)}\n`)
    forbiddenHits++
  }
}

const problems = secretHits + mockHits + forbiddenHits
log(`${files.length} fichiers vérifiés, ${problems} problème(s).`)
if (problems > 0) fail('la release contient des secrets ou des fichiers interdits (voir ci-dessus) : rien n\'a été packagé.')

// --- 4. Archive + sommes de contrôle ---
log('Archivage (tar.gz)…')
const tarball = `${releaseName}.tar.gz`
const tar = spawnSync('tar', ['-czf', tarball, '-C', releaseRoot, releaseName], { cwd: releaseRoot, stdio: 'inherit' })
if (tar.status !== 0) fail(`tar a échoué (code ${tar.status}).`)

const tarballPath = join(releaseRoot, tarball)
const hash = createHash('sha256').update(readFileSync(tarballPath)).digest('hex')
writeFileSync(join(releaseRoot, 'SHA256SUMS'), `${hash}  ${tarball}\n`)

log(`Terminé : release/${tarball}`)
log(`SHA256 : ${hash}`)
