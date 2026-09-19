/**
 * Rafraîchissement des jetons d'accès OIDC d'une session (mode MAIL_SSO_AUTH=oauth2).
 *
 * Politique : paresseuse, à l'usage. Avant chaque accès à la messagerie (requireMail,
 * ManageSieve), si le jeton expire dans moins de `marginMs`, il est rafraîchi avec le
 * jeton de rafraîchissement (gardé en mémoire serveur uniquement). Un seul
 * rafraîchissement à la fois par session (requêtes concurrentes dédupliquées).
 *
 * Horloge et appel au fournisseur injectables : testé sans réseau (tests/unit/auth/oidc-refresh.test.ts).
 */

/** Rafraîchir quand il reste moins d'une minute : couvre la durée d'une connexion IMAP/SMTP. */
export const REFRESH_MARGIN_MS = 60_000
/** Durée supposée d'un jeton d'accès quand le fournisseur ne renvoie pas `expires_in`. */
export const DEFAULT_TOKEN_LIFETIME_MS = 10 * 60_000

export interface OAuth2State {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

export interface RefreshedTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  idToken?: string
}

export type RefreshOutcome = 'fresh' | 'refreshed' | 'expired'

export interface RefreshClock {
  now: () => number
}

/** Instant (ms) à partir duquel le jeton doit être rafraîchi. */
export function refreshDueAt(auth: Pick<OAuth2State, 'expiresAt'>, marginMs = REFRESH_MARGIN_MS): number {
  return auth.expiresAt - marginMs
}

export function needsRefresh(auth: Pick<OAuth2State, 'expiresAt'>, now: number, marginMs = REFRESH_MARGIN_MS): boolean {
  return now >= refreshDueAt(auth, marginMs)
}

/** Échéance absolue d'un jeton à partir de `expires_in` (secondes), ou la durée par défaut. */
export function expiresAtFrom(expiresInSeconds: number | undefined, now: number): number {
  return typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? now + expiresInSeconds * 1000
    : now + DEFAULT_TOKEN_LIFETIME_MS
}

/**
 * Refus définitif du fournisseur (`invalid_grant` : jeton de rafraîchissement révoqué ou
 * expiré, session IdP fermée, compte désactivé) : la session Colombe doit se terminer.
 */
export function isPermanentRefreshError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { error?: unknown; cause?: { error?: unknown } }
  return e.error === 'invalid_grant' || e.cause?.error === 'invalid_grant'
}

export interface TokenRefresherOptions {
  /** Appel au fournisseur (refresh_token grant). */
  refresh: (refreshToken: string) => Promise<RefreshedTokens>
  clock?: RefreshClock
  marginMs?: number
}

export class TokenRefresher {
  private readonly refresh: (refreshToken: string) => Promise<RefreshedTokens>
  private readonly clock: RefreshClock
  private readonly marginMs: number
  private readonly inflight = new Map<string, Promise<RefreshOutcome>>()

  constructor(opts: TokenRefresherOptions) {
    this.refresh = opts.refresh
    this.clock = opts.clock ?? { now: () => Date.now() }
    this.marginMs = opts.marginMs ?? REFRESH_MARGIN_MS
  }

  /**
   * Garantit un jeton utilisable pour la session `key`.
   *   - fresh     : rien à faire (ou rafraîchissement impossible mais jeton encore valide) ;
   *   - refreshed : nouveaux jetons appliqués via `apply` ;
   *   - expired   : jeton expiré et non renouvelable, ou refus définitif du fournisseur.
   */
  ensureFresh(key: string, auth: OAuth2State, apply: (tokens: RefreshedTokens) => void): Promise<RefreshOutcome> {
    if (!needsRefresh(auth, this.clock.now(), this.marginMs)) return Promise.resolve('fresh')
    const running = this.inflight.get(key)
    if (running) return running
    const task = this.run(auth, apply).finally(() => this.inflight.delete(key))
    this.inflight.set(key, task)
    return task
  }

  private async run(auth: OAuth2State, apply: (tokens: RefreshedTokens) => void): Promise<RefreshOutcome> {
    const stillValid = () => this.clock.now() < auth.expiresAt
    if (!auth.refreshToken) return stillValid() ? 'fresh' : 'expired'
    try {
      const tokens = await this.refresh(auth.refreshToken)
      apply(tokens)
      return 'refreshed'
    }
    catch (err) {
      // Panne passagère du fournisseur : on garde le jeton tant qu'il est valide, on retentera.
      if (isPermanentRefreshError(err)) return 'expired'
      return stillValid() ? 'fresh' : 'expired'
    }
  }
}
