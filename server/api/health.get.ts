import { version } from '../../package.json'

/**
 * Sonde de disponibilité (Docker HEALTHCHECK, systemd, load balancer). Sans
 * authentification, sans information interne (pas d'hôte, pas de compteur) :
 * seulement de quoi savoir que le processus répond et sa version.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { status: 'ok', version }
})
