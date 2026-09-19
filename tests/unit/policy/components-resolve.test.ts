/**
 * Un composant appelé sous un nom que Nuxt ne connaît pas (ex. <ContactForm> au lieu de
 * <ContactsContactForm>, préfixe de dossier) ne provoque qu'un avertissement Vue : la zone
 * reste vide en production. Chaque balise PascalCase doit être un composant enregistré par
 * Nuxt (.nuxt/components.d.ts, généré par `nuxt prepare`), un composant intégré ou un import.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BUILTINS = new Set(['NuxtLink', 'NuxtPage', 'NuxtLayout', 'NuxtRouteAnnouncer', 'NuxtLoadingIndicator', 'ClientOnly', 'Teleport', 'Transition', 'TransitionGroup', 'KeepAlive', 'Suspense', 'Component'])

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? vueFiles(path) : path.endsWith('.vue') ? [path] : []
  })
}

describe('politique : composants résolus', () => {
  it.skipIf(!existsSync('.nuxt/components.d.ts'))('should only use components known to Nuxt, built in, or imported', () => {
    const dts = readFileSync('.nuxt/components.d.ts', 'utf8')
    const known = new Set([
      ...[...dts.matchAll(/^\s*'?([A-Z][A-Za-z0-9]+)'?\s*:/gm)].map(m => m[1]),
      ...[...dts.matchAll(/export const ([A-Z][A-Za-z0-9]+)\b/g)].map(m => m[1]),
    ])
    const offenders: string[] = []
    for (const file of vueFiles('app')) {
      const src = readFileSync(file, 'utf8')
      const cut = src.indexOf('<template>')
      if (cut < 0) continue
      const script = src.slice(0, cut)
      for (const [, tag] of src.slice(cut).matchAll(/<([A-Z][A-Za-z0-9]+)[\s/>]/g)) {
        if (!tag || known.has(tag) || BUILTINS.has(tag)) continue
        if (new RegExp(String.raw`import[^;]*\b${tag}\b`).test(script)) continue
        offenders.push(`${file}: <${tag}>`)
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })
})
