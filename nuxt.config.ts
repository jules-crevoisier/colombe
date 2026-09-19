import tailwindcss from '@tailwindcss/vite'

const csp = [
  "default-src 'self'",
  // Nuxt injecte un script inline de configuration ; aucune origine externe n'est autorisée.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Les iframes srcdoc héritent de cette politique : https: n'est utile qu'après
  // un clic explicite sur « Afficher les images ». Le blocage par défaut est fait
  // côté serveur (sanitize) et par la CSP propre au document de l'iframe.
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  // Application derrière authentification : pas de SEO, rendu 100 % client.
  // Évite toute une classe de bugs d'hydratation ; l'API Nitro reste côté serveur.
  ssr: false,
  modules: ['@pinia/nuxt', 'nuxt-auth-utils', 'shadcn-nuxt'],
  css: ['~/assets/css/tailwind.css'],
  vite: {
    plugins: [tailwindcss()],
    // vue-i18n (build esm-bundler) : API de composition seule, compilation JIT des
    // messages (sans eval, compatible avec la CSP), pas d'outils de développement.
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
      __INTLIFY_DROP_MESSAGE_COMPILER__: false,
    },
  },
  shadcn: {
    prefix: '',
    componentDir: '@/components/ui',
  },
  typescript: {
    strict: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Colombe',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'referrer', content: 'no-referrer' },
      ],
      // Le lien favicon (préfixé par le chemin de déploiement) est injecté dans le HTML
      // initial au moment de la requête par server/plugins/favicon.ts : NUXT_APP_BASE_URL
      // se lit au RUNTIME (une même archive de release sert n'importe quel chemin de
      // déploiement), il ne peut donc pas être figé ici au moment du build.
    },
  },
  runtimeConfig: {
    session: {
      name: 'wm_session',
      password: process.env.NUXT_SESSION_PASSWORD || '',
      maxAge: 60 * 60 * 8,
      cookie: {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
      },
    },
  },
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      },
    },
    '/api/**': {
      headers: { 'Cache-Control': 'no-store' },
    },
  },
  $production: {
    routeRules: {
      '/**': {
        headers: {
          'Content-Security-Policy': csp,
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        },
      },
    },
  },
})
