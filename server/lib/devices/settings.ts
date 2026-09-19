import type { DeviceSettings } from '#shared/types/config'
import { authUsername } from '../config'
import type { ColombeConfig } from '../config'

/** Ce que l'utilisateur connecté saisit dans un autre logiciel (GET /api/devices/settings). */
export function deviceSettings(email: string, config: Pick<ColombeConfig, 'login' | 'clients' | 'forwardDomains' | 'branding'>): DeviceSettings {
  return {
    email,
    username: authUsername(email, config),
    imap: config.clients.imap ? { ...config.clients.imap } : null,
    smtp: config.clients.smtp ? { ...config.clients.smtp } : null,
    forwardDomains: [...config.forwardDomains],
    productName: config.branding.productName,
  }
}
