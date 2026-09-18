/**
 * Gestionnaire de connexions IMAP IDLE par session utilisateur.
 * Une connexion IMAP dédiée par session, avec reference counting et grâce.
 */
import { ImapFlow } from 'imapflow'
import type { MailCredentials, MailServerConfig } from '../mail/backend'
import { publishMailboxChange } from './bus'

/**
 * Crée un client ImapFlow pour IDLE avec auto-IDLE activé.
 * Contrairement au client du backend IMAP, celui-ci laisse imapflow gérer l'IDLE automatiquement.
 */
function createIdleClient(creds: MailCredentials, config: MailServerConfig): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.imapPort,
    secure: config.imapSecure,
    servername: config.host,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    // Ne pas désactiver l'auto-IDLE : on veut que imapflow gère IDLE automatiquement
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 5 * 60_000,
  })
  // Gérer les erreurs réseau sans crash du processus
  client.on('error', () => {})
  return client
}

interface MailboxLock {
  release: () => void
}

interface WatcherSession {
  client: ImapFlow | null
  mailboxLock: MailboxLock | null
  refCount: number
  debounceTimer: NodeJS.Timeout | null
  closeTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  lastError: Date | null
  reconnectAttempts: number
}

export interface WatcherOptions {
  /** Factory pour créer des clients ImapFlow (injectable pour les tests). */
  clientFactory?: (creds: MailCredentials, config: MailServerConfig) => ImapFlow
  /** Durée de la grâce avant fermeture (ms). Default 30000. */
  gracePeriodMs?: number
  /** Limite du nombre total de watchers. Default 500. */
  maxWatchers?: number
}

/**
 * Gestionnaire de connexions IMAP IDLE. Une seule instance globale.
 * Gère un pool de connexions par session ID (sid).
 */
export class InboxWatcher {
  private sessions = new Map<string, WatcherSession>()
  private readonly gracePeriodMs: number
  private readonly maxWatchers: number
  private readonly clientFactory: (creds: MailCredentials, config: MailServerConfig) => ImapFlow

  constructor(opts: WatcherOptions = {}) {
    this.gracePeriodMs = opts.gracePeriodMs ?? 30_000
    this.maxWatchers = opts.maxWatchers ?? 500
    this.clientFactory = opts.clientFactory ?? createIdleClient
  }

  /**
   * Acquiert ou réutilise une connexion IMAP pour la session.
   * Première acquisition crée la connexion et ouvre INBOX en IDLE.
   * Les acquisitions suivantes du même SID incrémentent le refcount.
   */
  async acquire(sid: string, creds: MailCredentials, config: MailServerConfig): Promise<void> {
    const existing = this.sessions.get(sid)
    if (existing) {
      existing.refCount++
      if (existing.closeTimer) {
        clearTimeout(existing.closeTimer)
        existing.closeTimer = null
      }
      return
    }

    // New session: check limit
    if (this.sessions.size >= this.maxWatchers) {
      throw new Error(`Too many open watchers (max ${this.maxWatchers})`)
    }

    const session: WatcherSession = {
      client: null,
      mailboxLock: null,
      refCount: 1,
      debounceTimer: null,
      closeTimer: null,
      reconnectTimer: null,
      lastError: null,
      reconnectAttempts: 0,
    }

    this.sessions.set(sid, session)

    try {
      await this.connect(sid, creds, config, session)
    }
    catch (err: unknown) {
      this.sessions.delete(sid)
      throw err
    }
  }

  /**
   * Établit la connexion, sélectionne INBOX et laisse imapflow passer en IDLE
   * automatiquement dès que la connexion est inactive. Ne bloque pas : IDLE
   * est une commande « longue » qu'il ne faut pas attendre.
   */
  private async connect(
    sid: string,
    creds: MailCredentials,
    config: MailServerConfig,
    session: WatcherSession,
  ): Promise<void> {
    const client = this.clientFactory(creds, config)
    session.client = client
    client.on('error', () => {
      session.lastError = new Date()
    })

    const onMailboxChange = () => {
      if (session.debounceTimer) clearTimeout(session.debounceTimer)
      session.debounceTimer = setTimeout(() => {
        session.debounceTimer = null
        publishMailboxChange(creds.email, 'INBOX')
      }, 500)
    }
    client.on('exists', onMailboxChange)
    client.on('expunge', onMailboxChange)
    client.on('flags', onMailboxChange)

    try {
      await client.connect()
      await client.mailboxOpen('INBOX', { readOnly: true })
      // IDLE immédiat, sans l'attendre (la promesse ne se résout qu'à la sortie d'IDLE).
      // imapflow y retourne ensuite automatiquement après chaque commande.
      void client.idle().catch(() => {})
    }
    catch (err: unknown) {
      session.client = null
      client.close()
      throw err
    }
    session.reconnectAttempts = 0

    // Connexion perdue alors que la session est encore suivie : reconnexion
    // avec backoff exponentiel (1 s → 60 s). Un refus d'authentification arrête tout.
    client.on('close', () => {
      if (session.client !== client) return
      session.client = null
      if (session.refCount <= 0 || this.sessions.get(sid) !== session) return
      const delay = Math.min(60_000, 1000 * 2 ** session.reconnectAttempts)
      session.reconnectAttempts += 1
      session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null
        if (session.refCount <= 0 || this.sessions.get(sid) !== session) return
        this.connect(sid, creds, config, session).catch((err: unknown) => {
          const authFailed = typeof err === 'object' && err !== null && (err as { authenticationFailed?: boolean }).authenticationFailed === true
          if (authFailed) this.sessions.delete(sid)
          else client.emit('close')
        })
      }, delay)
    })
  }

  /**
   * Décrémente le refcount. À 0 avec grace period, ferme la connexion.
   */
  release(sid: string): void {
    const session = this.sessions.get(sid)
    if (!session) return

    session.refCount--
    if (session.refCount > 0) return

    // Refcount at 0: schedule close
    if (session.closeTimer) clearTimeout(session.closeTimer)
    session.closeTimer = setTimeout(() => {
      this.sessions.delete(sid)
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
      if (session.debounceTimer) clearTimeout(session.debounceTimer)
      // Release mailbox lock first
      if (session.mailboxLock) {
        try {
          session.mailboxLock.release()
        }
        catch {
          // Ignore errors on release
        }
      }
      if (session.client?.usable) {
        session.client.logout().catch(() => {})
      }
      session.client = null
    }, this.gracePeriodMs)
  }

  /**
   * Ferme toutes les connexions de manière synchrone (shutdown).
   */
  async closeAll(): Promise<void> {
    for (const [sid, session] of this.sessions.entries()) {
      if (session.closeTimer) {
        clearTimeout(session.closeTimer)
      }
      if (session.debounceTimer) {
        clearTimeout(session.debounceTimer)
      }
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
      // Release mailbox lock first
      if (session.mailboxLock) {
        try {
          session.mailboxLock.release()
        }
        catch {
          // Ignore errors on release
        }
      }
      if (session.client?.usable) {
        try {
          await session.client.logout()
        }
        catch {
          // Ignore errors on close
        }
      }
    }
    this.sessions.clear()
  }
}

/**
 * Instance globale du gestionnaire IMAP IDLE.
 */
export const inboxWatcher = new InboxWatcher()
