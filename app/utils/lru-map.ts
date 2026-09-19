/**
 * Cache LRU minimal, en mémoire uniquement. Ne jamais adosser ce type à
 * localStorage/sessionStorage/IndexedDB : le contenu des mails ne doit pas
 * survivre à la fermeture de l'onglet (voir CLAUDE.md, règle de sécurité n°4).
 *
 * L'ordre d'insertion de la Map sert d'ordre de récence : `get` déplace la
 * clé lue en fin de map, `set` insère en fin et évince la plus ancienne
 * (première clé) si `maxSize` est dépassé.
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly maxSize: number) {
    if (maxSize < 1) throw new Error('maxSize doit être au moins 1')
  }

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  /** Lit une entrée et la marque comme la plus récemment utilisée. */
  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  /** Lit sans modifier l'ordre LRU (parcours en lecture seule). */
  peek(key: K): V | undefined {
    return this.map.get(key)
  }

  /** Insère ou remplace une entrée ; évince la plus ancienne si la capacité est dépassée. */
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  keys(): K[] {
    return [...this.map.keys()]
  }
}
