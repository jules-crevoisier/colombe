import type { MailBackend, MailCredentials, MailServerConfig } from '../mail/backend'
import { createBackend, type BackendKind } from '../mail/index'

interface PooledBackend {
  backend: MailBackend
  lastUsed: number
  idleTimer: NodeJS.Timeout | null
}

const IDLE_TIMEOUT = 5 * 60 * 1000 // 5 minutes

export class BackendPool {
  private backends = new Map<string, PooledBackend>()

  async getOrCreate(
    sid: string,
    kind: BackendKind,
    creds: MailCredentials,
    config: MailServerConfig
  ): Promise<MailBackend> {
    const existing = this.backends.get(sid)
    if (existing) {
      existing.lastUsed = Date.now()
      // Réarme le minuteur à chaque usage : fermeture 5 min après la DERNIÈRE requête.
      this.scheduleIdleClose(sid)
      return existing.backend
    }

    const backend = createBackend(kind, creds, config)
    const pooled: PooledBackend = {
      backend,
      lastUsed: Date.now(),
      idleTimer: null,
    }

    this.backends.set(sid, pooled)
    this.scheduleIdleClose(sid)

    return backend
  }

  private scheduleIdleClose(sid: string): void {
    const pooled = this.backends.get(sid)
    if (!pooled) return

    if (pooled.idleTimer) {
      clearTimeout(pooled.idleTimer)
    }

    pooled.idleTimer = setTimeout(async () => {
      await this.delete(sid)
    }, IDLE_TIMEOUT)

    // Unref the timer so it doesn't keep the process alive
    if (pooled.idleTimer.unref) {
      pooled.idleTimer.unref()
    }
  }

  async delete(sid: string): Promise<void> {
    const pooled = this.backends.get(sid)
    if (!pooled) return

    if (pooled.idleTimer) {
      clearTimeout(pooled.idleTimer)
    }

    try {
      await pooled.backend.close()
    } catch (err: unknown) {
      // Ignore errors during close
    }

    this.backends.delete(sid)
  }

  async deleteAll(): Promise<void> {
    for (const sid of this.backends.keys()) {
      await this.delete(sid)
    }
  }
}

// Global singleton
export const backendPool = new BackendPool()
