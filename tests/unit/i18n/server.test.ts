/**
 * Langue côté serveur : COLOMBE_DEFAULT_LANGUAGE (config publique), Accept-Language,
 * dictionnaires server/lib/i18n, résolution de la langue côté client (app/lib/i18n).
 */
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, publicConfig } from '../../../server/lib/config'
import { frenchText, parseAcceptLanguage, translate } from '../../../server/lib/i18n'
import fr from '../../../server/lib/i18n/fr'
import en from '../../../server/lib/i18n/en'
import { detectLocale, resolveLocale } from '../../../app/lib/i18n'

const base = { MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr' }

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env)
  }
  catch (err) {
    if (err instanceof ConfigError) return err.problems
    throw err
  }
  return []
}

describe('COLOMBE_DEFAULT_LANGUAGE', () => {
  it('vaut fr par défaut et est exposé par la configuration publique', () => {
    const c = loadConfig(base)
    expect(c.defaultLanguage).toBe('fr')
    expect(publicConfig(c).defaultLanguage).toBe('fr')
  })

  it('accepte en (casse indifférente)', () => {
    expect(loadConfig({ ...base, COLOMBE_DEFAULT_LANGUAGE: 'EN' }).defaultLanguage).toBe('en')
  })

  it('refuse une autre langue', () => {
    expect(problems({ ...base, COLOMBE_DEFAULT_LANGUAGE: 'de' })).toEqual(['COLOMBE_DEFAULT_LANGUAGE doit valoir fr ou en (reçu « de »).'])
  })
})

describe('Accept-Language', () => {
  it('prend la première langue fr/en par ordre de préférence', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en')
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr')
    expect(parseAcceptLanguage('de-DE, en-GB;q=0.7, fr;q=0.9')).toBe('fr')
    expect(parseAcceptLanguage('en;q=0, fr-CA')).toBe('fr')
  })

  it('renvoie null sans fr ni en', () => {
    expect(parseAcceptLanguage('de-DE,es;q=0.5')).toBeNull()
    expect(parseAcceptLanguage('')).toBeNull()
  })
})

describe('dictionnaires serveur', () => {
  it('ont les mêmes clés et les mêmes variables', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
    for (const key of Object.keys(fr) as Array<keyof typeof fr>) {
      expect(vars(en[key]), key).toBe(vars(fr[key]))
    }
  })

  it('remplacent les variables, y compris un message imbriqué', () => {
    expect(translate('en', 'auth.domainRefused', { domains: '@univ.fr' })).toBe('Only @univ.fr addresses are accepted.')
    const nested = { key: 'sieve.unsupportedFeature' as const, params: { feature: { key: 'sieve.feature.vacation' as const } } }
    expect(frenchText(nested)).toBe('Fonctionnalité non prise en charge par ce serveur de filtres : réponse automatique')
    expect(translate('en', nested.key, nested.params)).toBe('Feature not supported by this filter server: auto-reply')
  })

  it('gardent le texte français historique des messages de l\'API', () => {
    expect(translate('fr', 'auth.badCredentials')).toBe('Adresse ou mot de passe incorrect.')
    expect(translate('fr', 'sieve.forwardDomainRefused')).toBe('Transfert interdit vers ce domaine.')
    expect(translate('fr', 'alert.forwardSubject')).toBe('Colombe : transfert modifié sur votre compte')
  })
})

describe('langue de l\'interface (client)', () => {
  it('auto : première langue du navigateur en fr/en, sinon la langue par défaut', () => {
    expect(detectLocale(['en-US', 'fr'], 'fr')).toBe('en')
    expect(detectLocale(['de-DE', 'fr-CA', 'en'], 'en')).toBe('fr')
    expect(detectLocale(['de-DE', 'es'], 'en')).toBe('en')
    expect(detectLocale([], 'fr')).toBe('fr')
  })

  it('une préférence explicite gagne sur le navigateur', () => {
    expect(resolveLocale('fr', ['en-US'], 'en')).toBe('fr')
    expect(resolveLocale('en', ['fr-FR'], 'fr')).toBe('en')
    expect(resolveLocale('auto', ['en-GB'], 'fr')).toBe('en')
  })
})
