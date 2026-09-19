/**
 * Connexion LDAP unique et réutilisée par processus (pas un pool : une recherche
 * annuaire est courte et peu fréquente, une seule connexion suffit). Reconnecte à la
 * demande si la connexion précédente est fermée ou en erreur — voir directory.ts pour
 * la tentative de reconnexion après un échec de recherche.
 */
import { Client } from 'ldapts'
import type { LdapConfig } from '../config'

interface Pooled {
  client: Client
  url: string
}

let pooled: Pooled | null = null

function createClient(config: LdapConfig): Client {
  // ldapts bascule en connexion chiffrée dès que `tlsOptions` est fourni au
  // constructeur, même pour une URL ldap:// — ne le passer que pour ldaps:// (StartTLS
  // reçoit ses propres options directement dans client.startTLS(), plus bas).
  const tlsOptions = config.url.startsWith('ldaps:') ? { rejectUnauthorized: true } : undefined
  return new Client({
    url: config.url,
    timeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
    // Vérification du certificat toujours active : ldaps:// n'a de sens que si le
    // certificat du serveur est authentique (voir ConfigError si ldap:// sans STARTTLS
    // vers un hôte distant dans server/lib/config/index.ts).
    tlsOptions,
  })
}

async function connectAndBind(config: LdapConfig): Promise<Client> {
  const client = createClient(config)
  try {
    if (config.startTls) await client.startTLS({ rejectUnauthorized: true })
    if (config.bindDn !== null && config.bindPassword !== null) await client.bind(config.bindDn, config.bindPassword)
    else await client.bind('', '') // liaison anonyme (RFC 4513) : DN et mot de passe vides
  }
  catch (err) {
    try {
      await client.unbind()
    }
    catch {
      // la connexion est de toute façon abandonnée
    }
    throw err
  }
  return client
}

/** Connexion active et liée, créée/rétablie si nécessaire. */
export async function getLdapClient(config: LdapConfig): Promise<Client> {
  if (pooled && pooled.url === config.url && pooled.client.isConnected) {
    return pooled.client
  }
  if (pooled) {
    try {
      await pooled.client.unbind()
    }
    catch {
      // déjà fermée côté serveur
    }
    pooled = null
  }
  const client = await connectAndBind(config)
  pooled = { client, url: config.url }
  return client
}

/** Force une reconnexion au prochain appel (après une erreur de recherche, et pour les tests). */
export function resetLdapClient(): void {
  if (pooled) {
    const { client } = pooled
    pooled = null
    void client.unbind().catch(() => {
      // ignoré : la connexion est de toute façon abandonnée
    })
  }
}
