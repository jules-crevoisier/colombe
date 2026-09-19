/**
 * Configuration visible par le navigateur (GET /api/config, sans authentification).
 * Ne contient que ce que la page de connexion affiche déjà : jamais d'hôte interne,
 * de port interne ni de secret.
 */
export interface PublicConfig {
  /** Nom du produit affiché (défaut « Colombe »). */
  productName: string
  /** Établissement, ex. « IUT de Troyes · Département MMI ». Vide si non configuré. */
  orgName: string
  /** Phrase sous le titre de la page de connexion. Vide si non configurée. */
  loginMessage: string
  /** Lien « Besoin d'aide ? » (http/https) ou null. */
  supportUrl: string | null
  /** Adresse du support, ou null. */
  supportEmail: string | null
  /** Lien « Mot de passe oublié ? » vers l'outil de l'établissement, ou null. */
  passwordResetUrl: string | null
  /** Un logo personnalisé est servi par GET /api/branding/logo. */
  hasLogo: boolean
  login: {
    /** Domaines acceptés à la connexion (minuscules), ex. ["univ-exemple.fr"]. */
    domains: string[]
    /** Domaine ajouté quand l'utilisateur ne saisit que son identifiant (sans @), ou null. */
    defaultDomain: string | null
  }
}

/** Sécurité d'une connexion côté client de messagerie. */
export type ClientSecurity = 'ssl' | 'starttls'

/**
 * Paramètres à saisir dans un autre logiciel (Gmail, Outlook, Apple Mail, Thunderbird).
 * Hôtes PUBLICS (MAIL_PUBLIC_*), qui peuvent différer de ceux qu'utilise Colombe
 * (souvent `localhost` quand Colombe tourne sur le serveur de messagerie).
 */
export interface ClientServerSettings {
  imap: { host: string; port: number; security: ClientSecurity } | null
  smtp: { host: string; port: number; security: ClientSecurity } | null
  /** Identifiant à saisir : l'adresse complète ou la partie avant @. */
  username: 'email' | 'localpart'
}
