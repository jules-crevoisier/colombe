/**
 * Comptes visiteurs de la démo publique (COLOMBE_DEMO=true).
 *
 * Chaque compte est jetable : boîte mémoire (server/lib/mail/mock.ts) + lignes
 * SQLite (base en mémoire elle-même en démo, server/lib/store/db.ts) + sessions
 * (server/lib/session/credentials.ts). Il disparaît soit au bout de sa durée de
 * vie (COLOMBE_DEMO_TTL_HOURS), soit immédiatement s'il faut faire de la place
 * sous COLOMBE_DEMO_MAX_ACCOUNTS.
 *
 * Les fonctions `expired`/`overflow` sont pures (liste + horloge en entrée) pour
 * rester testables sans minuteur réel ; `DemoAccountManager` porte l'état et les
 * effets de bord (mailbox, base, sessions), avec une horloge injectable.
 */
import { randomBytes } from 'node:crypto'
import { createDemoMailbox, deleteMockMailbox } from '../mail/mock'
import { credentialsStore } from '../session/credentials'
import { useDb } from '../store/db'
import { savePrefs } from '../store/prefs'

export interface DemoAccountRecord {
  email: string
  createdAt: number
}

interface Clock {
  now: () => number
}

/** Nom affiché par défaut d'un visiteur : la boîte « Bienvenue » ne s'ouvre pas (déjà « welcomed »). */
export const VISITOR_DISPLAY_NAME = 'Visiteur'

/** Tables SQLite avec une colonne `owner` (server/lib/store/db.ts) : purgées à l'éviction. */
const OWNER_TABLES = ['contacts', 'contact_groups', 'identities', 'responses', 'login_events', 'totp', 'recovery_codes', 'prefs'] as const

/** Adresse d'un nouveau compte visiteur : `visiteur-<8 hex>@<domaine>`. */
export function generateVisitorEmail(domain: string): string {
  return `visiteur-${randomBytes(4).toString('hex')}@${domain}`
}

/** Comptes dont l'âge dépasse `ttlHours` (fonction pure, testable sans minuteur). */
export function expired(records: DemoAccountRecord[], now: number, ttlHours: number): DemoAccountRecord[] {
  const ttlMs = ttlHours * 60 * 60 * 1000
  return records.filter(r => now - r.createdAt >= ttlMs)
}

/** Les comptes les plus anciens à retirer pour respecter `maxAccounts` (vide si déjà sous la limite). */
export function overflow(records: DemoAccountRecord[], maxAccounts: number): DemoAccountRecord[] {
  if (records.length <= maxAccounts) return []
  return [...records].sort((a, b) => a.createdAt - b.createdAt).slice(0, records.length - maxAccounts)
}

/** Préférences + identité par défaut d'un compte visiteur : jamais la boîte « Bienvenue ». */
function seedAccountRecord(email: string, now: number): void {
  const db = useDb()
  savePrefs(db, email, { welcomed: true })
  db.prepare(
    `INSERT INTO identities (owner, name, reply_to, bcc, organization, signature_html, is_default, created_at)
     VALUES (?, ?, '', '', '', '', 1, ?)`
  ).run(email, VISITOR_DISPLAY_NAME, new Date(now).toISOString())
}

export class DemoAccountManager {
  private accounts = new Map<string, DemoAccountRecord>()
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(private clock: Clock = { now: () => Date.now() }) {}

  /** Nombre de comptes visiteurs actuellement vivants. */
  count(): number {
    return this.accounts.size
  }

  /** Crée un compte visiteur, l'enregistre pour l'éviction, applique aussitôt `maxAccounts`. */
  create(domain: string, maxAccounts: number): string {
    const now = this.clock.now()
    const email = generateVisitorEmail(domain)
    this.accounts.set(email, { email, createdAt: now })
    createDemoMailbox(email, VISITOR_DISPLAY_NAME, now)
    seedAccountRecord(email, now)

    for (const stale of overflow([...this.accounts.values()], maxAccounts)) this.evict(stale.email)
    return email
  }

  /** Supprime la boîte, les lignes SQLite et les sessions d'un compte visiteur. */
  private evict(email: string): void {
    this.accounts.delete(email)
    deleteMockMailbox(email)
    const db = useDb()
    for (const table of OWNER_TABLES) db.prepare(`DELETE FROM ${table} WHERE owner = ?`).run(email)
    credentialsStore.revokeByOwner(email)
  }

  /** Retire les comptes expirés (COLOMBE_DEMO_TTL_HOURS). Appelé par le minuteur, ou directement en test. */
  sweep(ttlHours: number): void {
    const now = this.clock.now()
    for (const stale of expired([...this.accounts.values()], now, ttlHours)) this.evict(stale.email)
  }

  /** Démarre le balayage périodique (toutes les 5 min par défaut), minuteur `unref()`'d. */
  startSweep(ttlHours: number, intervalMs = 5 * 60 * 1000): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.sweep(ttlHours), intervalMs)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
  }

  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /** Tests uniquement : repart d'un état vide (sans toucher aux boîtes/base déjà créées). */
  clearForTests(): void {
    this.accounts.clear()
  }
}

/** Instance du processus. */
export const demoAccounts = new DemoAccountManager()
