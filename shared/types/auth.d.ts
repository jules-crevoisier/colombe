// Typage de la session nuxt-auth-utils.
// `secure` n'est jamais envoyé au client : il ne contient que des identifiants
// opaques côté serveur — jamais le mot de passe (voir docs/dev/PLAN.md).
declare module '#auth-utils' {
  interface User {
    email: string
  }

  interface SecureSessionData {
    /** Session mail ouverte (identifiants en mémoire serveur). */
    sid?: string
    /** Connexion en attente du code 2FA (mot de passe déjà vérifié). */
    pendingId?: string
  }

  // ─── SSO (OIDC) : début ───
  interface UserSession {
    /**
     * « oidc » : session ouverte par connexion unique (pas de mot de passe côté Colombe :
     * la confirmation d'une action sensible passe par une réauthentification chez le
     * fournisseur d'identité). Absent : connexion par mot de passe.
     */
    authMethod?: 'oidc'
  }
  // ─── SSO (OIDC) : fin ───
}

export {}
