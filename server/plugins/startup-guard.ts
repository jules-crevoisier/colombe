import { ConfigError, getConfig } from '../lib/config'
import { demoAccounts } from '../lib/demo/accounts'

/**
 * Garde-fous au démarrage : une configuration invalide ne doit jamais laisser
 * démarrer le webmail à moitié configuré (ex. avec les comptes de test du
 * backend mémoire). Toute la validation (secrets de production, TLS, backend
 * mock…) vit dans server/lib/config (loadConfig) ; ce greffon se contente de
 * charger la configuration une fois, au démarrage, et d'arrêter le processus
 * si elle est invalide plutôt que de laisser un serveur mal configuré répondre.
 *
 * Démarre aussi ici (et pas dans un greffon séparé) le balayage des comptes
 * démo expirés (server/lib/demo/accounts.ts) : l'ordre de chargement des
 * greffons Nitro n'est pas garanti, et getConfig() doit toujours être appelé
 * une première fois à l'intérieur de ce try/catch pour que ConfigError arrête
 * proprement le processus plutôt que de laisser échapper une pile d'erreurs.
 */
export default defineNitroPlugin(() => {
  try {
    const config = getConfig()
    if (config.demo.enabled) demoAccounts.startSweep(config.demo.ttlHours)
  }
  catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
})
