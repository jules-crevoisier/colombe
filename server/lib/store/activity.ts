import type { DatabaseSync } from 'node:sqlite'
import type { AccountActivity, LoginEvent } from '#shared/types/mail'

/** Au plus 100 lignes conservées par utilisateur (ROADMAP R2.6). */
const MAX_ROWS_PER_OWNER = 100
/** `AccountActivity.recent` : les 20 derniers événements (contrat R2.6/R2.8). */
const RECENT_COUNT = 20
/** Même limite que `CredentialsStore` pour le user-agent stocké côté session. */
const MAX_USER_AGENT_LENGTH = 300

/**
 * Enregistre une tentative de connexion (succès ou échec). `owner` = adresse
 * saisie en minuscules, y compris pour un échec (voir migration 2, table
 * `login_events`). Ne conserve que les `MAX_ROWS_PER_OWNER` lignes les plus
 * récentes par utilisateur.
 */
export function recordLoginEvent(db: DatabaseSync, owner: string, ip: string, userAgent: string, success: boolean): void {
  db.prepare('INSERT INTO login_events (owner, at, ip, user_agent, success) VALUES (?, ?, ?, ?, ?)').run(
    owner,
    new Date().toISOString(),
    ip,
    userAgent.slice(0, MAX_USER_AGENT_LENGTH),
    success ? 1 : 0
  )
  db.prepare(
    `DELETE FROM login_events WHERE owner = ? AND id NOT IN (
       SELECT id FROM login_events WHERE owner = ? ORDER BY at DESC LIMIT ?
     )`
  ).run(owner, owner, MAX_ROWS_PER_OWNER)
}

/**
 * `lastLogin` = la connexion réussie PRÉCÉDENTE, pas la connexion en cours :
 * au moment de cet appel, l'événement de la session active est déjà la
 * ligne la plus récente (`recordLoginEvent` a été appelé à l'authentification).
 */
export function getAccountActivity(db: DatabaseSync, owner: string): AccountActivity {
  const rows = db
    .prepare('SELECT at, ip, user_agent, success FROM login_events WHERE owner = ? ORDER BY at DESC LIMIT ?')
    .all(owner, RECENT_COUNT) as Array<{ at: string; ip: string; user_agent: string; success: number }>

  const recent: LoginEvent[] = rows.map(r => ({ at: r.at, ip: r.ip, userAgent: r.user_agent, success: r.success === 1 }))
  const successes = recent.filter(e => e.success)
  const lastLogin = successes[1] ?? null

  return { lastLogin, recent }
}
