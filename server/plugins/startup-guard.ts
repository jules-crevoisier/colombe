import { ConfigError, getConfig } from '../lib/config'

/**
 * Garde-fous au démarrage : une configuration invalide ne doit jamais laisser
 * démarrer le webmail à moitié configuré (ex. avec les comptes de test du
 * backend mémoire). Toute la validation (secrets de production, TLS, backend
 * mock…) vit dans server/lib/config (loadConfig) ; ce greffon se contente de
 * charger la configuration une fois, au démarrage, et d'arrêter le processus
 * si elle est invalide plutôt que de laisser un serveur mal configuré répondre.
 */
export default defineNitroPlugin(() => {
  try {
    getConfig()
  }
  catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
})
