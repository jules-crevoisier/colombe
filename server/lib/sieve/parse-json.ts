/**
 * Lecture/écriture du commentaire d'en-tête `# colombe:{base64 json}` qui
 * porte l'état structuré (règles, réponse automatique, transfert) d'un jeu de
 * filtres géré par Colombe. Absent ou invalide -> `managed: false` côté
 * appelant (service.ts).
 */
import type { FilterRule, ForwardSettings, VacationSettings } from '#shared/types/mail'

export interface ManagedScriptData {
  rules: FilterRule[]
  vacation: VacationSettings | null
  forward: ForwardSettings | null
}

const HEADER_RE = /^#\s*colombe:([A-Za-z0-9+/=]+)\s*$/m

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `null` si le script est absent de tout marqueur, ou si le JSON est invalide/mal formé. */
export function readManagedData(script: string): ManagedScriptData | null {
  const match = HEADER_RE.exec(script)
  if (!match?.[1]) return null
  try {
    const json = Buffer.from(match[1], 'base64').toString('utf-8')
    const data: unknown = JSON.parse(json)
    if (!isPlainObject(data) || !Array.isArray(data.rules)) return null
    return {
      rules: data.rules as FilterRule[],
      vacation: isPlainObject(data.vacation) ? (data.vacation as unknown as VacationSettings) : null,
      forward: isPlainObject(data.forward) ? (data.forward as unknown as ForwardSettings) : null,
    }
  } catch {
    return null
  }
}

/** Ligne de commentaire à placer en tête du script généré. */
export function writeManagedHeader(data: ManagedScriptData): string {
  const json = JSON.stringify({ rules: data.rules, vacation: data.vacation, forward: data.forward })
  const b64 = Buffer.from(json, 'utf-8').toString('base64')
  return `# colombe:${b64}`
}
