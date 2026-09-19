import { defineConfigWithTheme } from 'vitepress'
import type { DefaultTheme, HeadConfig } from 'vitepress'

/**
 * Site public de Colombe (présentation + documentation), servi à la racine d'un domaine.
 *
 * Valeurs lues au build, avec des défauts sûrs :
 *   COLOMBE_DEMO_URL  instance de démonstration (bouton « Essayer la démo »)
 *   COLOMBE_REPO_URL  dépôt des sources
 *   COLOMBE_SITE_URL  adresse publique du site (facultative : image de partage absolue
 *                     et sitemap.xml ; sans elle, ni l'une ni l'autre)
 *
 * Aucune ressource externe : polices auto-hébergées (@fontsource-variable, importées par
 * le thème), thème par défaut chargé sans sa police Inter, pas de statistiques.
 */

function envUrl(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return (value || fallback).replace(/\/+$/, '')
}

const demoUrl = envUrl('COLOMBE_DEMO_URL', 'https://demo.colombe.srko.fr')
const repoUrl = envUrl('COLOMBE_REPO_URL', 'https://github.com/jules-crevoisier/colombe')
const siteUrl = process.env.COLOMBE_SITE_URL?.trim().replace(/\/+$/, '') || ''

export interface ColombeThemeConfig extends DefaultTheme.Config {
  colombe: { demoUrl: string, repoUrl: string }
}

/**
 * Pages de la documentation en cours de rédaction (liste figée). Tant qu'elles
 * n'existent pas, les liens vers elles ne font pas échouer le build ; tout autre lien
 * mort, si. VitePress passe le lien tel qu'écrit, sans ancre ni extension, avec
 * « index » ajouté s'il finit par « / » : il peut donc être absolu (/admin/securite) ou
 * relatif (./securite, ../guide/, securite).
 */
const PLANNED_PAGES = [
  'guide/index', 'guide/messages', 'guide/filtres', 'guide/contacts', 'guide/securite',
  'guide/autres-applications', 'guide/raccourcis',
  'admin/index', 'admin/installation-docker', 'admin/installation-archive', 'admin/proxy-inverse',
  'admin/configuration', 'admin/configuration-automatique', 'admin/migration-roundcube',
  'admin/securite', 'admin/exploitation', 'admin/depannage', 'admin/demo',
  'contribuer',
]

function isPlannedPage(link: string): boolean {
  const path = link.replace(/^\/+/, '')
  if (PLANNED_PAGES.includes(path)) return true
  if (link.startsWith('/')) return false
  // Lien relatif : on retire les « ./ » et « ../ » de tête et on compare à la fin des
  // chemins prévus, segment entier (« securite » → admin/securite ou guide/securite).
  const tail = path.replace(/^(\.\.?\/)+/, '')
  return tail !== '' && PLANNED_PAGES.some(page => page === tail || page.endsWith(`/${tail}`))
}

const head: HeadConfig[] = [
  ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  ['meta', { name: 'theme-color', content: '#f4f1ea', media: '(prefers-color-scheme: light)' }],
  ['meta', { name: 'theme-color', content: '#0d1324', media: '(prefers-color-scheme: dark)' }],
  ['meta', { property: 'og:type', content: 'website' }],
  ['meta', { property: 'og:locale', content: 'fr_FR' }],
  ['meta', { property: 'og:site_name', content: 'Colombe' }],
  ['meta', { property: 'og:image', content: `${siteUrl}/og.png` }],
  ['meta', { property: 'og:image:width', content: '1200' }],
  ['meta', { property: 'og:image:height', content: '630' }],
  ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
]

export default defineConfigWithTheme<ColombeThemeConfig>({
  lang: 'fr-FR',
  title: 'Colombe',
  titleTemplate: ':title · Colombe',
  description: 'Webmail libre (AGPL-3.0) pour les établissements qui exploitent leur propre serveur Dovecot et Postfix. Remplace Roundcube sans toucher au serveur de messagerie.',
  base: '/',
  cleanUrls: true,
  outDir: '.vitepress/dist',
  // dev/ : notes de conception internes, hors du site.
  srcExclude: ['dev/**'],
  // Aucune police chargée depuis l'extérieur ; celles du thème sont importées localement.
  useWebFonts: false,
  head,
  ignoreDeadLinks: [isPlannedPage],
  ...(siteUrl ? { sitemap: { hostname: siteUrl } } : {}),

  markdown: {
    theme: { light: 'github-light-default', dark: 'github-dark-default' },
    codeCopyButtonTitle: 'Copier le code',
    container: {
      infoLabel: 'Information',
      noteLabel: 'Note',
      tipLabel: 'Conseil',
      warningLabel: 'Attention',
      dangerLabel: 'Danger',
      detailsLabel: 'Détails',
      importantLabel: 'Important',
      cautionLabel: 'Prudence',
    },
  },

  themeConfig: {
    colombe: { demoUrl, repoUrl },
    logo: { src: '/logo.svg', alt: '' },
    siteTitle: 'Colombe',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '^/guide/' },
      { text: 'Administration', link: '/admin/', activeMatch: '^/admin/' },
      { text: 'Contribuer', link: '/contribuer' },
      { text: 'Démo', link: demoUrl },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide utilisateur',
          items: [
            { text: 'Premiers pas', link: '/guide/' },
            { text: 'Lire et écrire', link: '/guide/messages' },
            { text: 'Filtres, absence, transfert', link: '/guide/filtres' },
            { text: 'Contacts', link: '/guide/contacts' },
            { text: 'Sécurité du compte', link: '/guide/securite' },
            { text: 'Gmail, iPhone, Outlook…', link: '/guide/autres-applications' },
            { text: 'Raccourcis clavier', link: '/guide/raccourcis' },
          ],
        },
      ],
      '/admin/': [
        {
          text: 'Administration',
          items: [
            { text: 'Vue d’ensemble', link: '/admin/' },
          ],
        },
        {
          text: 'Installer',
          items: [
            { text: 'Avec Docker', link: '/admin/installation-docker' },
            { text: 'Avec l’archive (systemd)', link: '/admin/installation-archive' },
            { text: 'Proxy inverse et HTTPS', link: '/admin/proxy-inverse' },
          ],
        },
        {
          text: 'Configurer',
          items: [
            { text: 'Référence de configuration', link: '/admin/configuration' },
            { text: 'Configuration automatique des clients', link: '/admin/configuration-automatique' },
            { text: 'Migrer depuis Roundcube', link: '/admin/migration-roundcube' },
          ],
        },
        {
          text: 'Exploiter',
          items: [
            { text: 'Sécurité', link: '/admin/securite' },
            { text: 'Exploitation', link: '/admin/exploitation' },
            { text: 'Dépannage', link: '/admin/depannage' },
            { text: 'Instance de démonstration', link: '/admin/demo' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: repoUrl, ariaLabel: 'Dépôt des sources de Colombe' },
    ],

    editLink: {
      pattern: `${repoUrl}/edit/main/docs/:path`,
      text: 'Proposer une modification de cette page',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Rechercher', buttonAriaLabel: 'Rechercher dans la documentation' },
          modal: {
            displayDetails: 'Afficher le détail',
            resetButtonTitle: 'Effacer la recherche',
            backButtonTitle: 'Fermer la recherche',
            noResultsText: 'Aucun résultat pour',
            footer: {
              selectText: 'ouvrir',
              selectKeyAriaLabel: 'Entrée',
              navigateText: 'parcourir',
              navigateUpKeyAriaLabel: 'flèche haut',
              navigateDownKeyAriaLabel: 'flèche bas',
              closeText: 'fermer',
              closeKeyAriaLabel: 'Échap',
            },
          },
        },
      },
    },

    outline: { level: [2, 3], label: 'Sur cette page' },
    docFooter: { prev: 'Page précédente', next: 'Page suivante' },
    darkModeSwitchLabel: 'Apparence',
    lightModeSwitchTitle: 'Passer en mode clair',
    darkModeSwitchTitle: 'Passer en mode sombre',
    sidebarMenuLabel: 'Sommaire',
    returnToTopLabel: 'Retour en haut',
    langMenuLabel: 'Changer de langue',
    skipToContentLabel: 'Aller au contenu',
    externalLinkIcon: true,
    notFound: {
      title: 'Page introuvable',
      quote: 'Cette adresse ne mène nulle part. La page a peut-être été déplacée.',
      linkLabel: 'Revenir à l’accueil',
      linkText: 'Revenir à l’accueil',
      code: '404',
    },
  },
})
