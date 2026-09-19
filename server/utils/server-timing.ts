import type { H3Event } from 'h3'
import { appendResponseHeader } from 'h3'

/**
 * Mesure de durée en production pour les routes visées par le correctif de
 * performance (messages, folders, prefs, filters — voir le rapport de
 * capture réseau). En-tête standard `Server-Timing: <name>;dur=<ms>`,
 * aucune donnée sensible : juste un nom de métrique et une durée.
 */
export async function withServerTiming<T>(event: H3Event, name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const dur = (performance.now() - start).toFixed(1)
    appendResponseHeader(event, 'Server-Timing', `${name};dur=${dur}`)
  }
}
