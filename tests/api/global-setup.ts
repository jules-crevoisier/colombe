/**
 * Démarre le serveur Nuxt déjà construit (.output) en mode backend mémoire.
 * `pnpm test:api` enchaîne `nuxt build` puis ces tests.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    apiBase: string
  }
}

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

let server: ChildProcess | null = null

// Base SQLite jetable par exécution.
const dataDir = mkdtempSync(join(tmpdir(), 'webmail-api-'))

export async function setup(project: TestProject): Promise<void> {
  if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:api` (nuxt build puis tests).')

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let logs = ''
  server = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      NUXT_MAIL_BACKEND: 'mock',
      WEBMAIL_ALLOW_MOCK: '1',
      NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-characters-long',
      WEBMAIL_DATA_KEY: 'test-data-key-at-least-32-characters-long-xx',
      WEBMAIL_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout?.on('data', (d: Buffer) => { logs += d.toString() })
  server.stderr?.on('data', (d: Buffer) => { logs += d.toString() })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Le serveur s'est arrêté :\n${logs}`)
    try {
      const res = await fetch(`${base}/api/_auth/session`)
      if (res.ok) {
        project.provide('apiBase', base)
        return
      }
    }
    catch {
      // pas encore prêt
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Serveur non prêt après 30 s :\n${logs}`)
}

export async function teardown(): Promise<void> {
  const proc = server
  server = null
  if (proc && proc.exitCode === null) {
    // Windows : la base SQLite reste verrouillée tant que le processus n'est pas sorti.
    const exited = new Promise(resolve => proc.once('exit', resolve))
    proc.kill()
    await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
  }
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
