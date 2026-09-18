// Sérialise « nuxt build + tests API » quand plusieurs processus les lancent en parallèle
// (même dossier .output). Verrou = création atomique d'un dossier ; verrou périmé après 20 min.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'

const LOCK = '.build.lock'
const STALE_MS = 20 * 60 * 1000
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function acquire() {
  for (;;) {
    try {
      mkdirSync(LOCK)
      return
    }
    catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmSync(LOCK, { recursive: true, force: true })
      }
      catch {}
      process.stdout.write('[build-lock] en attente d’un autre build…\n')
      await sleep(5000)
    }
  }
}

await acquire()
let code = 1
try {
  const cmd = process.argv.slice(2).join(' ')
  code = spawnSync(cmd, { stdio: 'inherit', shell: true }).status ?? 1
}
finally {
  rmSync(LOCK, { recursive: true, force: true })
}
process.exit(code)
