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
    },
  },
  runtimeConfig: {
    mail: {
      // 'imap' (serveur réel) ou 'mock' (serveur en mémoire pour dev et tests)
      backend: process.env.MAIL_BACKEND || 'imap',
      host: process.env.MAIL_HOST || 'mail.mmi-troyes.fr',
      imapPort: Number(process.env.MAIL_IMAP_PORT || 993),
      imapSecure: (process.env.MAIL_IMAP_SECURE || 'true') === 'true',
      smtpPort: Number(process.env.MAIL_SMTP_PORT || 587),
      smtpRequireTls: (process.env.MAIL_SMTP_REQUIRE_TLS || 'true') === 'true',
      allowedDomain: process.env.MAIL_ALLOWED_DOMAIN || 'mmi-troyes.fr',
      // true uniquement derrière le reverse proxy Apache (voir clientIp())
      trustProxy: process.env.NUXT_MAIL_TRUST_PROXY === 'true',
      // --- F : filtres, réponse automatique, transfert (ManageSieve) ---
      // Vide par défaut : le repli sur `mail.host` se fait au moment de la requête
      // (server/lib/sieve/service.ts), pour rester dynamique même si seul
      // NUXT_MAIL_HOST est redéfini au démarrage (sans NUXT_MAIL_SIEVE_HOST).
      sieveHost: process.env.MAIL_SIEVE_HOST || '',
      sievePort: Number(process.env.MAIL_SIEVE_PORT || 4190),
      // Domaines autorisés pour tout transfert/redirection/notification (liste séparée par des virgules).
      forwardDomains: process.env.MAIL_FORWARD_DOMAINS || 'mmi-troyes.fr',
      // false uniquement en dev, contre le certificat auto-signé du conteneur Dovecot.
      tlsRejectUnauthorized: process.env.MAIL_TLS_REJECT_UNAUTHORIZED !== 'false',
    },
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
