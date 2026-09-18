/**
 * Règle de sécurité n°5 : aucune ressource externe (CDN, Google Fonts…).
 * Échoue si une URL http(s) vers un domaine tiers apparaît dans le code client
 * ou la configuration (hors commentaires de documentation et espaces de noms XML).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = ['app', 'nuxt.config.ts', 'components.json']
const ALLOWED = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/(localhost|127\.0\.0\.1)/, /^https:\/\/shadcn-vue\.com\/schema\.json$/]

function files(path: string): string[] {
  const st = statSync(path)
  if (st.isFile()) return /\.(vue|ts|css|json|html)$/.test(path) ? [path] : []
  return readdirSync(path).flatMap(name => (name === 'node_modules' ? [] : files(join(path, name))))
}

describe('politique : aucune ressource externe', () => {
  it('should not reference third-party URLs in client code, CSS or config', () => {
    const offenders: string[] = []
    for (const file of ROOTS.flatMap(files)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|<!--)/.test(line)) return
        for (const [url] of line.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
          if (!ALLOWED.some(re => re.test(url))) offenders.push(`${file}:${i + 1} ${url}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
