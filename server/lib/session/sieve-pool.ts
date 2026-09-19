/**
 * Pool de connexions ManageSieve, une par session (sid) — miroir de
 * `server/lib/session/pool.ts` (IMAP/SMTP) pour le même problème : chaque
 * appel à /api/filters* ouvrait jusqu'ici une connexion TLS + un login
 * ManageSieve neufs (voir server/lib/sieve/service.ts avant ce correctif).
 *
 * ManageSieve ne traite qu'une commande à la fois sur une connexion : les
 * appels concurrents pour un même sid sont donc sérialisés sur une file de
 * promesses. Une erreur de connexion (socket fermé, délai dépassé) jette la
 * session et retente une fois avec une connexion fraîche avant d'abandonner.
 *
 * Un petit cache de contenu de script par sid vient avec le pool : il évite
 * de renvoyer GETSCRIPT pour un script déjà lu depuis la dernière écriture
 * (PUTSCRIPT/DELETESCRIPT/SETACTIVE l'invalident). Il n'existe que pour les
 * sessions poolées (backend réel) : le mock n'y passe jamais (il reste géré
 * tel quel, en mémoire, sans coût réseau).
 */
import { SieveError } from '../sieve/client'
import type { SieveSessionLike } from '../sieve/service'

/** Fermeture pour inactivité : ManageSieve est peu utilisé par requête, pas besoin de la garder
 * ouverte aussi longtemps que le pool IMAP (5 min) — 60 s couvre largement une session de réglages. */
const IDLE_TIMEOUT = 60 * 1000

export interface SieveConnectResult {
  available: boolean
  session: SieveSessionLike | null
  capabilities: string[]
}

type SieveRunOutcome<T> = { available: true; result: T } | { available: false }

interface PooledSieve {
  session: SieveSessionLike
  capabilities: string[]
  idleTimer: NodeJS.Timeout | null
  /** Contenu de script déjà lu depuis la dernière écriture connue. */
  scripts: Map<string, string>
}

function isConnectionError(err: unknown): boolean {
  return err instanceof SieveError && (err.code === 'UNAVAILABLE' || err.code === 'CONNECT_FAILED')
}

export class SievePool {
  private pool = new Map<string, PooledSieve>()
  /**
   * Queue de sérialisation par sid — existe indépendamment de `pool` : elle doit
   * couvrir aussi bien l'ouverture de la toute première connexion (deux appels
   * concurrents avant qu'une session n'existe encore) que les commandes une fois
   * la session établie, sinon deux `run()` synchrones décident chacun de leur
   * côté qu'il n'y a « pas encore de session » et ouvrent deux connexions.
   */
  private queues = new Map<string, Promise<void>>()

  /**
   * Exécute `fn` sur la session ManageSieve du sid : la crée via `connect()`
   * si absente, la réutilise sinon. Sérialisé par sid — y compris l'ouverture
   * elle-même. Sur erreur de connexion, jette la session et retente une fois
   * avec une session neuve avant d'abandonner (comme `connect()` au premier essai).
   */
  run<T>(
    sid: string,
    connect: () => Promise<SieveConnectResult>,
    fn: (session: SieveSessionLike, capabilities: string[]) => Promise<T>
  ): Promise<SieveRunOutcome<T>> {
    const previous = this.queues.get(sid) ?? Promise.resolve()

    const task: Promise<SieveRunOutcome<T>> = previous.then(async () => {
      let pooled = this.pool.get(sid)
      if (!pooled) {
        const created = await this.open(connect)
        if (!created) return { available: false }
        pooled = created
        this.pool.set(sid, pooled)
      }
      this.scheduleIdleClose(sid)

      try {
        return { available: true, result: await fn(pooled.session, pooled.capabilities) }
      } catch (err) {
        if (!isConnectionError(err)) throw err
        // Connexion probablement morte (timeout serveur, RST…) : on jette et on retente une fois.
        await this.delete(sid)
        const fresh = await this.open(connect)
        if (!fresh) return { available: false }
        this.pool.set(sid, fresh)
        this.scheduleIdleClose(sid)
        return { available: true, result: await fn(fresh.session, fresh.capabilities) }
      }
    })

    // La file continue même après un échec : elle ne doit jamais rester bloquée sur un rejet,
    // et se nettoie d'elle-même une fois vide (pas de fuite d'une entrée par sid historique).
    const settled = task.then(() => undefined, () => undefined)
    this.queues.set(sid, settled)
    void settled.then(() => {
      if (this.queues.get(sid) === settled) this.queues.delete(sid)
    })

    return task
  }

  private async open(connect: () => Promise<SieveConnectResult>): Promise<PooledSieve | null> {
    const { available, session, capabilities } = await connect()
    if (!available || !session) return null
    return { session, capabilities, idleTimer: null, scripts: new Map() }
  }

  private scheduleIdleClose(sid: string): void {
    const pooled = this.pool.get(sid)
    if (!pooled) return
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    pooled.idleTimer = setTimeout(() => {
      void this.delete(sid)
    }, IDLE_TIMEOUT)
    if (pooled.idleTimer.unref) pooled.idleTimer.unref()
  }

  // ─── Cache de contenu de script (par sid) ───

  getCachedScript(sid: string, name: string): string | undefined {
    return this.pool.get(sid)?.scripts.get(name)
  }

  setCachedScript(sid: string, name: string, content: string): void {
    this.pool.get(sid)?.scripts.set(name, content)
  }

  invalidateScript(sid: string, name: string): void {
    this.pool.get(sid)?.scripts.delete(name)
  }

  invalidateAllScripts(sid: string): void {
    this.pool.get(sid)?.scripts.clear()
  }

  // ─── Cycle de vie ───

  async delete(sid: string): Promise<void> {
    const pooled = this.pool.get(sid)
    if (!pooled) return
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    this.pool.delete(sid)
    try {
      await pooled.session.close()
    } catch {
      // Ignoré : on ferme quoi qu'il arrive.
    }
  }

  async deleteAll(): Promise<void> {
    for (const sid of [...this.pool.keys()]) await this.delete(sid)
  }
}

// Singleton global, comme `backendPool`.
export const sievePool = new SievePool()
