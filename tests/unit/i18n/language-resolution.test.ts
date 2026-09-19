/**
 * Résolution de la langue active (app/lib/i18n.ts) : ordre de priorité — préférence de
 * compte explicite (fr/en) > choix fait sur ce navigateur (sélecteur FR | EN de la page
 * de connexion) > langue du navigateur > langue par défaut de l'établissement — et
 * persistance du choix (`colombe.lang`), avec un stockage/navigateur factices injectables
 * (pas de jsdom : l'environnement de ces tests est `node`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserLanguages,
  clearStoredLanguage,
  readStoredLanguage,
  resolveAppLocale,
  storeLanguage,
} from '~/lib/i18n'

describe('resolveAppLocale', () => {
  it('compte « auto », choix explicite mémorisé : le choix explicite gagne sur le navigateur', () => {
    expect(resolveAppLocale('auto', 'en', ['fr-FR', 'fr'], 'fr')).toBe('en')
    expect(resolveAppLocale('auto', 'fr', ['en-US'], 'en')).toBe('fr')
  })

  it('compte « auto », aucun choix explicite : la langue du navigateur gagne sur la langue par défaut', () => {
    expect(resolveAppLocale('auto', null, ['en-US', 'fr-FR'], 'fr')).toBe('en')
    expect(resolveAppLocale('auto', null, ['fr-CA'], 'en')).toBe('fr')
  })

  it('compte « auto », ni choix explicite ni langue du navigateur reconnue : langue par défaut de l\'établissement', () => {
    expect(resolveAppLocale('auto', null, [], 'fr')).toBe('fr')
    expect(resolveAppLocale('auto', null, ['de-DE', 'es-ES'], 'en')).toBe('en')
  })

  it('préférence de compte explicite (fr/en) : gagne toujours, le choix mémorisé sur ce navigateur est ignoré', () => {
    expect(resolveAppLocale('fr', 'en', ['en-US'], 'en')).toBe('fr')
    expect(resolveAppLocale('en', 'fr', ['fr-FR'], 'fr')).toBe('en')
    // Même sans aucun choix mémorisé.
    expect(resolveAppLocale('en', null, ['fr-FR'], 'fr')).toBe('en')
  })
})

describe('browserLanguages (navigateur injectable)', () => {
  it('renvoie navigator.languages quand il est présent', () => {
    expect(browserLanguages({ languages: ['fr-FR', 'fr', 'en-US'] })).toEqual(['fr-FR', 'fr', 'en-US'])
  })

  it('se rabat sur navigator.language si navigator.languages est vide ou absent', () => {
    expect(browserLanguages({ languages: [], language: 'en-GB' })).toEqual(['en-GB'])
    expect(browserLanguages({ language: 'fr-BE' })).toEqual(['fr-BE'])
  })

  it('renvoie un tableau vide si le navigateur ne donne ni languages ni language', () => {
    expect(browserLanguages({})).toEqual([])
  })

  it('renvoie un tableau vide sans aucun navigateur (Node en fournit un par défaut : globalThis.navigator est neutralisé)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(browserLanguages()).toEqual([])
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stockage minimal en mémoire, conforme à `StorageLike`. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    dump: () => Object.fromEntries(data),
  }
}

describe('readStoredLanguage / storeLanguage / clearStoredLanguage (stockage injectable)', () => {
  it('lit fr/en, ignore toute autre valeur (dont « auto », jamais stocké)', () => {
    expect(readStoredLanguage(fakeStorage({ 'colombe.lang': 'en' }))).toBe('en')
    expect(readStoredLanguage(fakeStorage({ 'colombe.lang': 'fr' }))).toBe('fr')
    expect(readStoredLanguage(fakeStorage({ 'colombe.lang': 'auto' }))).toBeNull()
    expect(readStoredLanguage(fakeStorage({ 'colombe.lang': 'de' }))).toBeNull()
  })

  it('sans clé : aucun choix explicite', () => {
    expect(readStoredLanguage(fakeStorage())).toBeNull()
  })

  it('storeLanguage écrit la clé, lisible ensuite', () => {
    const storage = fakeStorage()
    storeLanguage('en', storage)
    expect(storage.dump()).toEqual({ 'colombe.lang': 'en' })
    expect(readStoredLanguage(storage)).toBe('en')
  })

  it('clearStoredLanguage efface la clé (retour à « auto »)', () => {
    const storage = fakeStorage({ 'colombe.lang': 'en' })
    clearStoredLanguage(storage)
    expect(storage.dump()).toEqual({})
    expect(readStoredLanguage(storage)).toBeNull()
  })

  it('un stockage qui lève (navigation privée) ne fait jamais échouer l\'appelant', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(readStoredLanguage(throwing)).toBeNull()
    expect(() => storeLanguage('en', throwing)).not.toThrow()
    expect(() => clearStoredLanguage(throwing)).not.toThrow()
  })
})
