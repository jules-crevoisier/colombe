/**
 * Faux serveur ManageSieve en mémoire (MAIL_BACKEND=mock), pour l'interface
 * et les tests API. Même forme que le mock IMAP (server/lib/mail/mock.ts) :
 * un magasin partagé par processus, réinitialisable entre tests.
 */
import { SieveError } from './client'
import { tokenizeSieve } from './scan'

/** Capacités annoncées : voir docs/dev/PLAN-v4.md section F. */
export const SIEVE_MOCK_CAPABILITIES = [
  'fileinto',
  'vacation',
  'copy',
  'imap4flags',
  'date',
  'relational',
  'body',
  'reject',
  'editheader',
  'variables',
  'enotify',
] as const

interface MockUserState {
  scripts: Map<string, string>
  active: string | null
}

let store = new Map<string, MockUserState>()

function stateFor(email: string): MockUserState {
  let s = store.get(email)
  if (!s) {
    s = { scripts: new Map(), active: null }
    store.set(email, s)
  }
  return s
}

/** Remet le magasin à zéro (tests / `POST /api/__mock/reset`). */
export function resetSieveMock(): void {
  store = new Map()
}

export class MockSieveSession {
  constructor(private readonly email: string) {}

  capabilities(): string[] {
    return [...SIEVE_MOCK_CAPABILITIES]
  }

  async listScripts(): Promise<{ name: string; active: boolean }[]> {
    const s = stateFor(this.email)
    return [...s.scripts.keys()].map((name) => ({ name, active: name === s.active }))
  }

  async getScript(name: string): Promise<string> {
    const s = stateFor(this.email)
    const content = s.scripts.get(name)
    if (content === undefined) throw new SieveError('NOT_FOUND', `Jeu de filtres introuvable : ${name}`, undefined, { key: 'sieve.setNotFoundNamed', params: { name } })
    return content
  }

  async putScript(name: string, content: string): Promise<void> {
    await this.checkScript(content)
    stateFor(this.email).scripts.set(name, content)
  }

  /** Sanité basique via le lexique Sieve (pas une validation sémantique complète, comme un vrai serveur). */
  async checkScript(content: string): Promise<void> {
    if (!content.trim()) throw new SieveError('INVALID', 'Script Sieve vide', undefined, { key: 'sieve.emptyScript' })
    let opens = 0
    let closes = 0
    try {
      for (const tok of tokenizeSieve(content)) {
        if (tok.kind === 'block-start') opens++
        if (tok.kind === 'block-end') closes++
      }
    } catch {
      throw new SieveError('INVALID', 'Script Sieve invalide', undefined, { key: 'sieve.invalidSieve' })
    }
    if (opens !== closes) throw new SieveError('INVALID', 'Script Sieve invalide : blocs non équilibrés', undefined, { key: 'sieve.unbalanced' })
  }

  async setActive(name: string): Promise<void> {
    const s = stateFor(this.email)
    if (name !== '' && !s.scripts.has(name)) throw new SieveError('NOT_FOUND', `Jeu de filtres introuvable : ${name}`, undefined, { key: 'sieve.setNotFoundNamed', params: { name } })
    s.active = name === '' ? null : name
  }

  async deleteScript(name: string): Promise<void> {
    const s = stateFor(this.email)
    if (!s.scripts.has(name)) throw new SieveError('NOT_FOUND', `Jeu de filtres introuvable : ${name}`, undefined, { key: 'sieve.setNotFoundNamed', params: { name } })
    if (s.active === name) throw new SieveError('INVALID', 'Impossible de supprimer le jeu de filtres actif.', undefined, { key: 'sieve.cannotDeleteActive' })
    s.scripts.delete(name)
  }

  async renameScript(oldName: string, newName: string): Promise<void> {
    const s = stateFor(this.email)
    const content = s.scripts.get(oldName)
    if (content === undefined) throw new SieveError('NOT_FOUND', `Jeu de filtres introuvable : ${oldName}`, undefined, { key: 'sieve.setNotFoundNamed', params: { name: oldName } })
    s.scripts.delete(oldName)
    s.scripts.set(newName, content)
    if (s.active === oldName) s.active = newName
  }

  async close(): Promise<void> {
    // Rien à fermer : pas de connexion réseau.
    await Promise.resolve()
  }
}
