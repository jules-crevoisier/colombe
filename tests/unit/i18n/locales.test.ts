/**
 * Dictionnaires de l'interface (app/locales) : même forme en français et en anglais,
 * messages compilables par vue-i18n, mêmes variables `{x}` dans les deux langues, et
 * toute clé écrite en dur dans app/ (t('…'), $t('…'), keypath="…") existe.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import fr from '../../../app/locales/fr'
import en from '../../../app/locales/en'

type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of leaves(value, path)) out.set(k, v)
  }
  return out
}

function nodeAt(tree: Tree, path: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree
  for (const part of path.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

/** Variables nommées d'un message (`{name}`), hors littéraux échappés (`{'@'}`). */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*\}/g)].map(m => m[1] ?? ''))].sort()
}

const frLeaves = leaves(fr as Tree)
const enLeaves = leaves(en as Tree)

describe('dictionnaires fr / en', () => {
  it('ont exactement les mêmes clés', () => {
    expect([...enLeaves.keys()].filter(k => !frLeaves.has(k))).toEqual([])
    expect([...frLeaves.keys()].filter(k => !enLeaves.has(k))).toEqual([])
  })

  it('utilisent les mêmes variables {x} dans les deux langues', () => {
    const mismatches = [...frLeaves].flatMap(([key, message]) => {
      const other = enLeaves.get(key)
      if (other === undefined) return []
      const a = placeholders(message).join(',')
      const b = placeholders(other).join(',')
      return a === b ? [] : [`${key}: fr {${a}} / en {${b}}`]
    })
    expect(mismatches).toEqual([])
  })

  it('ne contiennent aucun message vide', () => {
    const empty = [...frLeaves, ...enLeaves].filter(([, m]) => !m.trim()).map(([k]) => k)
    expect(empty).toEqual([])
  })

  it('compilent sans erreur (syntaxe vue-i18n : @, {, |)', () => {
    for (const locale of ['fr', 'en'] as const) {
      const errors: string[] = []
      const i18n = createI18n({
        legacy: false,
        locale,
        messages: { fr, en },
        missingWarn: false,
        fallbackWarn: false,
        warnHtmlMessage: false,
      })
      const originalWarn = console.warn
      console.warn = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
      try {
        for (const key of frLeaves.keys()) {
          try {
            const out = i18n.global.t(key, { n: 2, count: 2 }, 2)
            if (out === key) errors.push(`${locale}:${key} non résolu`)
          }
          catch (err) {
            errors.push(`${locale}:${key}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
      finally {
        console.warn = originalWarn
      }
      expect(errors).toEqual([])
    }
  })

  it('rendent les caractères littéraux échappés (ex. « @ » dans une adresse)', () => {
    const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr, en } })
    expect(i18n.global.t('login.addressExample', { domain: 'univ.fr' })).toBe('prenom.nom@univ.fr')
  })
})

describe('clés utilisées dans app/', () => {
  const files = sourceFiles('app')
  const used: Array<{ file: string, key: string, dynamic: boolean }> = []
  const patterns = [
    /(?:\$t|\bt|\bte|i18n\.global\.t)\(\s*'([^'\n]+)'/g,
    /(?:\$t|\bt|\bte|i18n\.global\.t)\(\s*"([^"\n]+)"/g,
    /(?:\$t|\bt|\bte|i18n\.global\.t)\(\s*`([^`\n]+)`/g,
    /\bkeypath="([^"]+)"/g,
  ]
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const raw = m[1] ?? ''
        if (!/^[a-z][\w.${}]*$/i.test(raw)) continue
        const cut = raw.indexOf('${')
        used.push({ file, key: cut >= 0 ? raw.slice(0, cut) : raw, dynamic: cut >= 0 })
      }
    }
  }

  it('trouve des usages (garde-fou du motif de recherche)', () => {
    expect(used.length).toBeGreaterThan(20)
  })

  it('existent dans fr.ts', () => {
    const missing = used.flatMap(({ file, key, dynamic }) => {
      if (dynamic) {
        // `folders.special.${use}` : le préfixe doit désigner un groupe de messages.
        const prefix = key.replace(/\.$/, '')
        return prefix && typeof nodeAt(fr as Tree, prefix) === 'object' ? [] : [`${file}: ${key}…`]
      }
      return frLeaves.has(key) ? [] : [`${file}: ${key}`]
    })
    expect([...new Set(missing)]).toEqual([])
  })
})
