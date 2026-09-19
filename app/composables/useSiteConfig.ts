import type { PublicConfig } from '#shared/types/config'

const FALLBACK: PublicConfig = {
  productName: 'Colombe',
  orgName: '',
  loginMessage: '',
  supportUrl: null,
  supportEmail: null,
  passwordResetUrl: null,
  hasLogo: false,
  login: { domains: [], defaultDomain: null, methods: ['password'], oidc: null },
  limits: { attachmentsBytes: 10 * 1024 * 1024 },
  demo: null,
  features: { directory: false },
  portalUrl: null,
}

/**
 * Configuration publique de l'établissement (GET /api/config), chargée une fois
 * par onglet. `config` vaut FALLBACK tant que la réponse n'est pas arrivée ou si
 * elle échoue : l'interface reste utilisable avec le nom « Colombe ».
 */
export function useSiteConfig() {
  const config = useState<PublicConfig>('site-config', () => FALLBACK)
  const loaded = useState<boolean>('site-config-loaded', () => false)

  async function load(): Promise<PublicConfig> {
    if (loaded.value) return config.value
    try {
      config.value = await $fetch<PublicConfig>('/api/config')
      loaded.value = true
    }
    catch {
      // Repli silencieux : nom par défaut.
    }
    return config.value
  }

  /** Exemple d'adresse pour les champs de saisie, ex. « prenom.nom@univ-exemple.fr ». */
  const addressExample = computed(() => {
    const domain = config.value.login.defaultDomain ?? config.value.login.domains[0]
    return domain ? `prenom.nom@${domain}` : 'prenom.nom@exemple.fr'
  })

  return { config: readonly(config), loaded: readonly(loaded), load, addressExample }
}
