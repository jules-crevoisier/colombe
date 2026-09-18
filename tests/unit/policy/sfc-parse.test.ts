/**
 * Détecte les erreurs de template (balise non fermée, v-model sur une expression,
 * guillemets typographiques dans une expression…) que `nuxt typecheck` laisse passer
 * mais qui cassent le serveur de développement et `nuxt build`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileTemplate, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : [])
}

describe('politique : templates Vue valides', () => {
  it('should parse and compile every single-file component without errors', () => {
    const errors = vueFiles('app').flatMap((file) => {
      const { descriptor, errors: parseErrors } = parse(readFileSync(file, 'utf8'), { filename: file })
      const messages = parseErrors.map(e => e.message)
      if (descriptor.template) {
        const compiled = compileTemplate({ source: descriptor.template.content, filename: file, id: file, compilerOptions: { isTS: true } })
        messages.push(...compiled.errors.map(e => (typeof e === 'string' ? e : e.message)))
      }
      return messages.map(m => `${file}: ${m}`)
    })
    expect(errors).toEqual([])
  })
})
