// Vérifie qu'aucun secret du .env de développement n'est présent dans le build de déploiement.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const secrets = ['NUXT_SESSION_PASSWORD', 'WEBMAIL_DATA_KEY'].map(k => [k, env[k]]).filter(([, v]) => v && v.length >= 8)

function walk(dir) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
}
const files = walk('.deploy/colombe')
let leaks = 0
for (const f of files) {
  const s = readFileSync(f, 'latin1')
  for (const [k, v] of secrets) if (s.includes(v)) { console.log(`FUITE ${k} dans ${f}`); leaks++ }
  if (/backend:\s*["']mock["']/.test(s)) { console.log(`backend mock dans ${f}`); leaks++ }
}
console.log(`${files.length} fichiers vérifiés, ${secrets.length} secrets recherchés, ${leaks} problème(s)`)
process.exit(leaks ? 1 : 0)
