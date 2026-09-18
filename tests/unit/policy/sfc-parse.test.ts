/**
 * Détecte les erreurs de template (balise non fermée…) que `nuxt typecheck`
 * laisse passer mais qui cassent `nuxt build`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : [])
}

describe('politique : templates Vue valides', () => {
  it('should parse every single-file component without errors', () => {
    const errors = vueFiles('app').flatMap((file) => {
      const { errors: errs } = parse(readFileSync(file, 'utf8'), { filename: file })
      return errs.map(e => `${file}: ${e.message}`)
    })
    expect(errors).toEqual([])
  })
})
