import type { PublicConfig } from '#shared/types/config'
import { getConfig, publicConfig } from '../lib/config'

/** Configuration publique (page de connexion, nom de l'établissement). Sans authentification. */
export default defineEventHandler((event): PublicConfig => {
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  return publicConfig(getConfig())
})
