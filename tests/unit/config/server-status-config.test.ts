/**
 * Configuration de la page d'état du serveur mail : COLOMBE_ADMIN_EMAILS et
 * COLOMBE_SERVER_STATUS_FILE.
 */
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, publicConfig } from '../../../server/lib/config'

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

describe('état du serveur mail', () => {
  it('désactivé par défaut', () => {
    expect(loadConfig(base).serverStatus).toEqual({ adminEmails: [], file: null })
  })

  it('administrateurs en minuscules, séparés par des virgules ou des espaces', () => {
    const c = loadConfig({ ...base, COLOMBE_ADMIN_EMAILS: 'Prof@Univ-Exemple.fr, dsi@univ-exemple.fr', COLOMBE_SERVER_STATUS_FILE: '/var/lib/mail-sante/etat.json' })
    expect(c.serverStatus.adminEmails).toEqual(['prof@univ-exemple.fr', 'dsi@univ-exemple.fr'])
    expect(c.serverStatus.file).toBe('/var/lib/mail-sante/etat.json')
  })

  it('adresse d\'administrateur invalide refusée', () => {
    expect(problems({ ...base, COLOMBE_ADMIN_EMAILS: 'prof@univ-exemple.fr pas-une-adresse' }).some(p => p.includes('COLOMBE_ADMIN_EMAILS'))).toBe(true)
  })

  it('chemin du fichier d\'état : absolu obligatoire', () => {
    expect(problems({ ...base, COLOMBE_SERVER_STATUS_FILE: 'etat.json' }).some(p => p.includes('COLOMBE_SERVER_STATUS_FILE'))).toBe(true)
  })

  it('interdit en démo, où n\'importe qui peut ouvrir un compte', () => {
    expect(problems({ MAIL_BACKEND: 'mock', COLOMBE_DEMO: 'true', COLOMBE_ADMIN_EMAILS: 'dev@universite.example' }).some(p => p.includes('COLOMBE_ADMIN_EMAILS'))).toBe(true)
  })

  it('jamais exposé dans la configuration publique', () => {
    const c = loadConfig({ ...base, COLOMBE_ADMIN_EMAILS: 'prof@univ-exemple.fr', COLOMBE_SERVER_STATUS_FILE: '/var/lib/mail-sante/etat.json' })
    const json = JSON.stringify(publicConfig(c))
    expect(json).not.toContain('prof@univ-exemple.fr')
    expect(json).not.toContain('mail-sante')
  })
})
