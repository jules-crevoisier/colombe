/**
 * Petit lexique Sieve (chaînes, littéraux `{n+}`, `text:` multi-lignes,
 * commentaires `#`/`/* *\/`) utilisé pour analyser un script écrit à la main
 * et y refuser toute commande `redirect` / `notify` / `vacation :from` qui ne
 * respecte pas la liste blanche de domaines — sans jamais exécuter le script.
 *
 * Conservateur : une cible qui n'est pas une chaîne littérale simple (ex.
 * une variable `"${x}"`) est refusée, faute de pouvoir la résoudre.
 */
import { isAllowedForwardTarget } from './generate'

export type ScanToken =
  | { kind: 'ident'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'list-start' }
  | { kind: 'list-end' }
  | { kind: 'block-start' }
  | { kind: 'block-end' }
  | { kind: 'paren-start' }
  | { kind: 'paren-end' }
  | { kind: 'semicolon' }
  | { kind: 'comma' }
  | { kind: 'number'; value: string }

const isDigit = (c: string | undefined): boolean => !!c && c >= '0' && c <= '9'
const isIdentChar = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c)
const isTagChar = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_-]/.test(c)

/** Tokenise un script Sieve source (texte, pas les octets réseau — voir client.ts pour ceux-là). */
export function tokenizeSieve(source: string): ScanToken[] {
  const tokens: ScanToken[] = []
  const n = source.length
  let i = 0

  while (i < n) {
    const c = source[i] as string

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue }

    if (c === '#') {
      while (i < n && source[i] !== '\n') i++
      continue
    }

    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (c === '"') {
      i++
      let out = ''
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < n) { out += source[i + 1]; i += 2 }
        else { out += source[i]; i++ }
      }
      i++ // guillemet fermant
      tokens.push({ kind: 'string', value: out })
      continue
    }

    if (c === '{') {
      const m = /^\{(\d+)\+?\}\r?\n/.exec(source.slice(i))
      if (m?.[1]) {
        const len = Number(m[1])
        const start = i + m[0].length
        tokens.push({ kind: 'string', value: source.slice(start, start + len) })
        i = start + len
        continue
      }
      tokens.push({ kind: 'block-start' })
      i++
      continue
    }
    if (c === '}') { tokens.push({ kind: 'block-end' }); i++; continue }
    if (c === '(') { tokens.push({ kind: 'paren-start' }); i++; continue }
    if (c === ')') { tokens.push({ kind: 'paren-end' }); i++; continue }
    if (c === '[') { tokens.push({ kind: 'list-start' }); i++; continue }
    if (c === ']') { tokens.push({ kind: 'list-end' }); i++; continue }
    if (c === ';') { tokens.push({ kind: 'semicolon' }); i++; continue }
    if (c === ',') { tokens.push({ kind: 'comma' }); i++; continue }

    if (c === ':') {
      i++
      let out = ''
      while (i < n && isTagChar(source[i])) { out += source[i]; i++ }
      tokens.push({ kind: 'tag', value: out.toLowerCase() })
      continue
    }

    if (isDigit(c)) {
      let out = ''
      while (i < n && isDigit(source[i])) { out += source[i]; i++ }
      if (source[i] && /[KMG]/i.test(source[i] as string)) { out += source[i]; i++ }
      tokens.push({ kind: 'number', value: out })
      continue
    }

    if (/[A-Za-z_]/.test(c)) {
      let out = ''
      while (i < n && isIdentChar(source[i])) { out += source[i]; i++ }
      if (out.toLowerCase() === 'text' && source[i] === ':') {
        i++ // ':'
        while (i < n && source[i] !== '\n') i++ // reste de la ligne (commentaire éventuel)
        i++ // '\n'
        const lines: string[] = []
        while (i < n) {
          let lineEnd = source.indexOf('\n', i)
          if (lineEnd === -1) lineEnd = n
          let line = source.slice(i, lineEnd)
          if (line.endsWith('\r')) line = line.slice(0, -1)
          i = lineEnd + 1
          if (line === '.') break
          lines.push(line.startsWith('.') ? line.slice(1) : line)
        }
        tokens.push({ kind: 'string', value: lines.join('\n') })
        continue
      }
      tokens.push({ kind: 'ident', value: out })
      continue
    }

    // caractère inattendu : ignoré (analyse défensive, pas un compilateur Sieve)
    i++
  }

  return tokens
}

export interface ScanFinding {
  command: 'redirect' | 'notify' | 'vacation'
  /** `null` quand la cible n'est pas une chaîne littérale simple (ex. variable) — traité comme refusé. */
  target: string | null
}

const NOTIFY_VALUE_TAGS = new Set(['from', 'importance', 'message'])

/** Repère les commandes `redirect` / `notify` / `vacation` et leur cible textuelle. */
export function findRedirectTargets(tokens: ScanToken[]): ScanFinding[] {
  const findings: ScanFinding[] = []

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]
    if (t?.kind !== 'ident') continue
    const name = t.value.toLowerCase()
    if (name !== 'redirect' && name !== 'notify' && name !== 'vacation') continue

    let j = idx + 1
    let depth = 0
    const args: ScanToken[] = []
    while (j < tokens.length) {
      const tok = tokens[j] as ScanToken
      if (tok.kind === 'list-start') depth++
      if (tok.kind === 'list-end') depth--
      if (depth <= 0 && (tok.kind === 'semicolon' || tok.kind === 'block-start')) break
      args.push(tok)
      j++
    }

    if (name === 'redirect') {
      const first = args.find((a) => a.kind === 'string') as { kind: 'string'; value: string } | undefined
      findings.push({ command: 'redirect', target: sanitizeTarget(first?.value ?? null) })
    } else if (name === 'notify') {
      let k = 0
      let target: string | null = null
      while (k < args.length) {
        const a = args[k] as ScanToken
        if (a.kind === 'tag' && NOTIFY_VALUE_TAGS.has(a.value)) { k += 2; continue }
        if (a.kind === 'tag' && a.value === 'options') {
          k++
          if (args[k]?.kind === 'list-start') {
            while (k < args.length && args[k]?.kind !== 'list-end') k++
            k++
          }
          continue
        }
        if (a.kind === 'string') { target = a.value; k++; continue }
        k++
      }
      findings.push({ command: 'notify', target: sanitizeTarget(target) })
    } else {
      const fromIdx = args.findIndex((a) => a.kind === 'tag' && a.value === 'from')
      if (fromIdx >= 0) {
        const valTok = args[fromIdx + 1]
        const value = valTok?.kind === 'string' ? valTok.value : null
        findings.push({ command: 'vacation', target: sanitizeTarget(value) })
      }
    }

    idx = j
  }

  return findings
}

/** Une valeur contenant `${...}` (interpolation de variable) ne peut pas être validée statiquement : refusée. */
function sanitizeTarget(value: string | null): string | null {
  if (value === null) return null
  return value.includes('${') ? null : value
}

function stripMailto(target: string | null): string | null {
  if (target === null) return null
  const m = /^mailto:(.+)$/i.exec(target.trim())
  if (!m?.[1]) return null
  return m[1].split(/[?#]/)[0] ?? null
}

export interface ScanSecurityOptions {
  forwardDomains: string[]
  loginEmail: string
}

/**
 * Renvoie les messages d'erreur (FR, tels qu'attendus par le contrat) pour
 * chaque commande `redirect`/`notify`/`vacation :from` non conforme d'un
 * script écrit à la main. Tableau vide = script conforme.
 */
export function findForbiddenDirectives(script: string, opts: ScanSecurityOptions): string[] {
  const tokens = tokenizeSieve(script)
  const findings = findRedirectTargets(tokens)
  const problems: string[] = []

  for (const f of findings) {
    if (f.command === 'vacation') {
      if (f.target === null || f.target.toLowerCase() !== opts.loginEmail.toLowerCase()) {
        problems.push('La réponse automatique du script doit utiliser l\'adresse de connexion.')
      }
      continue
    }
    const address = f.command === 'notify' ? stripMailto(f.target) : f.target
    if (address === null || !isAllowedForwardTarget(address, opts.forwardDomains)) {
      problems.push('Transfert interdit vers ce domaine.')
    }
  }

  return problems
}
