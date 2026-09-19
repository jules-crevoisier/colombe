/**
 * Cache mémoire très court (60 s) des résultats de recherche annuaire : un même terme
 * tapé par plusieurs utilisateurs (ou retapé pendant l'autocomplétion) ne déclenche pas
 * une requête LDAP à chaque frappe. Résultats déjà filtrés par domaine (rien de secret).
 */
interface Entry<T> {
  value: T
  expiresAt: number
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>()
  private readonly ttlMs: number
  private readonly clock: () => number

  constructor(ttlMs: number, clock: () => number = () => Date.now()) {
    this.ttlMs = ttlMs
    this.clock = clock
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (this.clock() >= entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.clock() + this.ttlMs })
  }

  clear(): void {
    this.store.clear()
  }
}

/** Clé de cache normalisée : espaces superflus retirés, casse ignorée. */
export function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Recherches annuaire : 60 s, voir searchDirectory() dans directory.ts. */
export const directorySearchCache = new TtlCache<import('#shared/types/mail').DirectoryEntry[]>(60_000)
