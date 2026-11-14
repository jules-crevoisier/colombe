import type { ServerVerdict, TrafficHour } from '#shared/types/server-status'

/** Instant courant : millisecondes Unix ou Date. */
type Instant = number | Date

const MINUTE_MS = 60_000

function toMs(value: Instant): number {
  return value instanceof Date ? value.getTime() : value
}

/** Ton d'un service : arrêté → panne ; actif mais une sonde échoue → attention. */
export function serviceTone(service: { actif: boolean, sain: boolean }): ServerVerdict {
  if (!service.actif) return 'panne'
  return service.sain ? 'ok' : 'attention'
}

/**
 * Âge du relevé en minutes entières (jamais négatif) et indicateur de péremption :
 * périmé au-delà de deux intervalles de surveillance. Date illisible : âge inconnu, périmé.
 */
export function statusFreshness(
  genereLe: string,
  intervalleMinutes: number,
  now: Instant,
): { ageMinutes: number | null, stale: boolean } {
  const generated = Date.parse(genereLe)
  if (Number.isNaN(generated)) return { ageMinutes: null, stale: true }
  const ageMinutes = Math.max(0, Math.floor((toMs(now) - generated) / MINUTE_MS))
  return { ageMinutes, stale: ageMinutes > 2 * intervalleMinutes }
}

/** « il y a 5 minutes », « hier », « maintenant » ; chaîne vide si la date est illisible. */
export function relativeAge(iso: string, now: Instant, locale: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.floor((toMs(now) - then) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (seconds < 60) return formatter.format(0, 'second')
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return formatter.format(-Math.floor(seconds / 3600), 'hour')
  return formatter.format(-Math.floor(seconds / 86_400), 'day')
}

export interface TrafficBar {
  heure: string
  debut: string
  acceptes: number
  refus: number
  total: number
  /** Part de la hauteur maximale (0 à 100). */
  acceptesPct: number
  refusPct: number
}

/** Barres empilées : acceptés (soumis + reçus) et refus, relatifs à l'heure la plus chargée. */
export function trafficBars(heures: TrafficHour[]): TrafficBar[] {
  const rows = heures.map((h) => {
    const acceptes = h.soumis + h.recu
    const refus = h.rejete + h.rejet_entrant + h.quota + h.usurpation
    return { heure: h.heure, debut: h.debut, acceptes, refus, total: acceptes + refus }
  })
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0)
  return rows.map(r => ({
    ...r,
    acceptesPct: max === 0 ? 0 : (r.acceptes / max) * 100,
    refusPct: max === 0 ? 0 : (r.refus / max) * 100,
  }))
}

/** Certificat : inconnu ou proche de l'expiration → attention ; expiré → panne. */
export function certificateTone(jours: number | null): ServerVerdict {
  if (jours === null) return 'attention'
  if (jours <= 0) return 'panne'
  return jours <= 14 ? 'attention' : 'ok'
}

/** Disque : alerte à 90 %, saturé à partir de 98 %. */
export function diskTone(pourcent: number): ServerVerdict {
  if (pourcent >= 98) return 'panne'
  return pourcent >= 90 ? 'attention' : 'ok'
}
