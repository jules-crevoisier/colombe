import type { DeviceSettings } from '#shared/types/config'
import type { TwoFactorStatus } from '#shared/types/mail'

/**
 * Paramètres pour les autres logiciels de messagerie (onglet « Autres applications »
 * et domaines autorisés du transfert). Même politique qu'useSettingsApi : un 401
 * renvoie vers /login. Aucune mise en cache entre deux comptes : chaque appel interroge le serveur.
 */
export function useDevicesApi() {
  const session = useUserSession()

  async function get<T>(url: string): Promise<T> {
    try {
      const fetcher = $fetch as (url: string, init: { method: 'GET' }) => Promise<T>
      return await fetcher(url, { method: 'GET' })
    }
    catch (err) {
      if (statusOf(err) === 401) {
        await session.clear()
        await navigateTo('/login')
      }
      throw err
    }
  }

  return {
    settings: () => get<DeviceSettings>('/api/devices/settings'),
    twoFactor: () => get<TwoFactorStatus>('/api/account/2fa'),
    /** Lien de téléchargement du profil Apple (préfixé par le chemin de déploiement). */
    appleProfileUrl: () => apiUrl('/api/devices/apple.mobileconfig'),
  }
}
