/**
 * Reka UI : un DropdownMenuTrigger placé dans un <Tooltip> (ou qui enveloppe un
 * composant dont la racine est un Tooltip, comme MailIconButton) perd son ancre
 * et le menu s'ouvre hors de l'écran. Utiliser <MailMenuButton>.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN = [
  /<TooltipTrigger as-child>\s*<DropdownMenuTrigger/,
  /<DropdownMenuTrigger as-child>\s*<TooltipTrigger/,
  /<DropdownMenuTrigger as-child>\s*<MailIconButton/,
]

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === 'ui' ? [] : vueFiles(join(dir, e.name))) : e.name.endsWith('.vue') ? [join(dir, e.name)] : [])
}

describe('politique : déclencheurs de menus', () => {
  it('should never nest a dropdown trigger with a tooltip trigger', () => {
    const offenders = vueFiles('app').filter(f => FORBIDDEN.some(re => re.test(readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
  })
})
