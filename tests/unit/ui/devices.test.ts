import { describe, expect, it } from 'vitest'
import type { DeviceSettings } from '#shared/types/config'
import {
  appleManualSteps,
  canForwardToGmail,
  defaultDeviceApp,
  formatDomains,
  forwardPlaceholder,
  gmailAppSteps,
  gmailSendAsSteps,
  hasPublicServers,
  outlookSteps,
  splitQuoted,
  thunderbirdSteps,
} from '~/utils/devices'
import type { ReadyDeviceSettings } from '~/utils/devices'

const settings: ReadyDeviceSettings = {
  email: 'jeanne@univ-exemple.fr',
  username: 'jeanne',
  imap: { host: 'imap.univ-exemple.fr', port: 993, security: 'ssl' },
  smtp: { host: 'smtp.univ-exemple.fr', port: 587, security: 'starttls' },
  forwardDomains: ['univ-exemple.fr'],
  productName: 'Colombe',
}

const values = (steps: ReturnType<typeof gmailAppSteps>) => steps.flatMap(s => s.values ?? []).map(v => v.value)

describe('guides « Autres applications »', () => {
  it('should only show guides when both public servers are known', () => {
    expect(hasPublicServers(settings)).toBe(true)
    const partial: DeviceSettings = { ...settings, smtp: null }
    expect(hasPublicServers(partial)).toBe(false)
  })

  it('should fill every guide with the real values of the user', () => {
    for (const steps of [gmailAppSteps(settings), outlookSteps(settings), thunderbirdSteps(settings)]) {
      const v = values(steps)
      expect(v).toEqual(expect.arrayContaining(['imap.univ-exemple.fr', '993', 'SSL/TLS', 'smtp.univ-exemple.fr', '587', 'STARTTLS', 'jeanne']))
    }
    expect(values(appleManualSteps(settings))).toEqual(expect.arrayContaining(['jeanne@univ-exemple.fr', 'imap.univ-exemple.fr', 'smtp.univ-exemple.fr', '993', '587']))
    // Aucune valeur à copier n'est un mot de passe : l'utilisateur saisit le sien.
    const labels = [gmailAppSteps(settings), outlookSteps(settings), thunderbirdSteps(settings)].flat().flatMap(s => s.values ?? []).map(v => v.label)
    expect(labels.some(l => /mot de passe/i.test(l))).toBe(false)
  })

  it('should pick the Gmail « Send mail as » security option from the SMTP mode', () => {
    expect(gmailSendAsSteps(settings).map(s => s.text).join(' ')).toContain('« Connexion sécurisée via TLS »')
    const ssl = { ...settings, smtp: { ...settings.smtp, port: 465, security: 'ssl' as const } }
    expect(gmailSendAsSteps(ssl).map(s => s.text).join(' ')).toContain('« Connexion sécurisée via SSL »')
  })

  it('should allow forwarding to Gmail only when gmail.com is an allowed domain', () => {
    expect(canForwardToGmail(['univ-exemple.fr'])).toBe(false)
    expect(canForwardToGmail(['univ-exemple.fr', 'gmail.com'])).toBe(true)
    expect(canForwardToGmail(['notgmail.com'])).toBe(false)
  })

  it('should format allowed domains and build the forward placeholder from the first one', () => {
    expect(formatDomains(['a.fr', 'b.fr'])).toEqual(['@a.fr', '@b.fr'])
    expect(forwardPlaceholder(['univ-exemple.fr', 'gmail.com'])).toBe('destinataire@univ-exemple.fr')
    expect(forwardPlaceholder([])).toBe('destinataire@exemple.fr')
  })

  it('should highlight interface labels between French quotes', () => {
    expect(splitQuoted('Choisissez « Autre », puis « Suivant ».')).toEqual([
      { text: 'Choisissez ', quoted: false },
      { text: '« Autre »', quoted: true },
      { text: ', puis ', quoted: false },
      { text: '« Suivant »', quoted: true },
      { text: '.', quoted: false },
    ])
  })

  it('should suggest the iPhone guide on Apple mobile devices', () => {
    expect(defaultDeviceApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('apple')
    expect(defaultDeviceApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('apple')
    expect(defaultDeviceApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('gmail')
    expect(defaultDeviceApp('Mozilla/5.0 (Linux; Android 15)')).toBe('gmail')
  })
})
