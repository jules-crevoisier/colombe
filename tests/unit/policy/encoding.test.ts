/**
 * Un fichier réenregistré dans le mauvais encodage transforme « Sélectionner »
 * en « SÃ©lectionner » : les libellés accessibles ne correspondent plus et
 * l'interface affiche du charabia. Sources en UTF-8 sans BOM uniquement.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const EXTENSIONS = ['.vue', '.ts', '.mjs', '.css', '.md']
// Séquences typiques d'un UTF-8 décodé en Windows-1252 : Ã© (é), Â« («), â€™ (’), âœ“ (✓)…
const MOJIBAKE = /Ã[-¿]|Â[ -¿]|â€|âœ/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(join(dir, e.name))
    return EXTENSIONS.some(ext => e.name.endsWith(ext)) ? [join(dir, e.name)] : []
  })
}

// Ce fichier contient lui-même les séquences recherchées : exclu.
const files = ['app', 'server', 'shared', 'docs', 'scripts', 'tests'].flatMap(sourceFiles).filter(f => !f.endsWith('encoding.test.ts'))

describe('politique : encodage des sources', () => {
  it('should not contain double-encoded UTF-8', () => {
    const offenders = files.filter(f => MOJIBAKE.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('should not contain raw control characters (write \u0000 escapes instead)', () => {
    // Un NUL littéral fait passer le fichier pour binaire (git, grep, revue de code).
    const offenders = files.filter(f => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('should not start with a byte order mark', () => {
    const offenders = files.filter(f => readFileSync(f, 'utf8').charCodeAt(0) === 0xFEFF)
    expect(offenders).toEqual([])
  })
})
