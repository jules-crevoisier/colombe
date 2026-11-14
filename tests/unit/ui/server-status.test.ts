/**
 * Page « État du serveur » : logique d'affichage pure (tons, fraîcheur du
 * relevé, âges relatifs, barres d'activité sur 24 h).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TrafficHour } from '#shared/types/server-status'
import {
  certificateTone,
  diskTone,
  relativeAge,
  serviceTone,
  statusFreshness,
  trafficBars,
} from '~/utils/server-status'

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/etat-serveur.json', import.meta.url), 'utf8')) as {
  genere_le: string
  intervalle_minutes: number
  activite: { heures: TrafficHour[] }
}

/** Intl peut insérer des espaces insécables : on compare le texte, pas l'espacement. */
const plain = (s: string) => s.replace(/\s/g, ' ')

const hour = (heure: string, counters: Partial<TrafficHour> = {}): TrafficHour => ({
  heure,
  debut: '2026-11-14T12:00:00+01:00',
  soumis: 0,
  recu: 0,
  livre_local: 0,
  livre_externe: 0,
  differe: 0,
  rejete: 0,
  rejet_entrant: 0,
  quota: 0,
  usurpation: 0,
  ...counters,
})

describe('serviceTone', () => {
  it('actif et sain → ok', () => {
    expect(serviceTone({ actif: true, sain: true })).toBe('ok')
  })
  it('actif mais une sonde échoue → attention', () => {
    expect(serviceTone({ actif: true, sain: false })).toBe('attention')
  })
  it('arrêté → panne, même si la dernière sonde était bonne', () => {
    expect(serviceTone({ actif: false, sain: false })).toBe('panne')
    expect(serviceTone({ actif: false, sain: true })).toBe('panne')
  })
})

describe('statusFreshness', () => {
  const genere = Date.parse(fixture.genere_le)

  it('relevé récent : âge en minutes entières, pas périmé', () => {
    expect(statusFreshness(fixture.genere_le, 15, genere + 7 * 60_000 + 59_000)).toEqual({ ageMinutes: 7, stale: false })
  })

  it('périmé au-delà de deux intervalles (30 min pour 15 min)', () => {
    expect(statusFreshness(fixture.genere_le, 15, genere + 30 * 60_000)).toEqual({ ageMinutes: 30, stale: false })
    expect(statusFreshness(fixture.genere_le, 15, genere + 31 * 60_000)).toEqual({ ageMinutes: 31, stale: true })
  })

  it('suit l’intervalle déclaré par le fichier', () => {
    expect(statusFreshness(fixture.genere_le, 5, genere + 11 * 60_000).stale).toBe(true)
    expect(statusFreshness(fixture.genere_le, 60, genere + 90 * 60_000).stale).toBe(false)
  })

  it('accepte une Date comme instant courant', () => {
    expect(statusFreshness(fixture.genere_le, 15, new Date(genere + 3 * 60_000))).toEqual({ ageMinutes: 3, stale: false })
  })

  it('horloge en avance sur le serveur : âge ramené à 0', () => {
    expect(statusFreshness(fixture.genere_le, 15, genere - 5 * 60_000)).toEqual({ ageMinutes: 0, stale: false })
  })

  it('date illisible : âge inconnu, considéré comme périmé', () => {
    expect(statusFreshness('pas une date', 15, genere)).toEqual({ ageMinutes: null, stale: true })
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-11-14T14:00:00+01:00')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('moins d’une minute → maintenant', () => {
    expect(plain(relativeAge(ago(20_000), now, 'fr'))).toBe('maintenant')
    expect(plain(relativeAge(ago(20_000), now, 'en'))).toBe('now')
  })

  it('minutes, heures, jours (arrondis vers le bas)', () => {
    expect(plain(relativeAge(ago(5 * 60_000 + 50_000), now, 'fr'))).toBe('il y a 5 minutes')
    expect(plain(relativeAge(ago(2 * 3_600_000 + 59 * 60_000), now, 'fr'))).toBe('il y a 2 heures')
    expect(plain(relativeAge(ago(3 * 86_400_000 + 3_600_000), now, 'fr'))).toBe('il y a 3 jours')
    expect(plain(relativeAge(ago(5 * 60_000), now, 'en'))).toBe('5 minutes ago')
  })

  it('un jour → hier', () => {
    expect(plain(relativeAge(ago(26 * 3_600_000), now, 'fr'))).toBe('hier')
    expect(plain(relativeAge(ago(26 * 3_600_000), now, 'en'))).toBe('yesterday')
  })

  it('date future (décalage d’horloge) → maintenant', () => {
    expect(plain(relativeAge(new Date(now + 90_000).toISOString(), now, 'fr'))).toBe('maintenant')
  })

  it('date illisible → chaîne vide', () => {
    expect(relativeAge('n/a', now, 'fr')).toBe('')
  })
})

describe('trafficBars', () => {
  it('acceptés = soumis + reçus ; refus = rebonds + refus entrants + quota + usurpation', () => {
    const [bar] = trafficBars([hour('9 h', { soumis: 4, recu: 6, livre_local: 9, livre_externe: 3, differe: 2, rejete: 1, rejet_entrant: 2, quota: 3, usurpation: 4 })])
    expect(bar).toEqual({ heure: '9 h', debut: '2026-11-14T12:00:00+01:00', acceptes: 10, refus: 10, total: 20, acceptesPct: 50, refusPct: 50 })
  })

  it('hauteurs relatives à l’heure la plus chargée, ordre conservé', () => {
    const bars = trafficBars([hour('1 h', { recu: 10 }), hour('2 h', { recu: 30, quota: 10 }), hour('3 h')])
    expect(bars.map(b => b.heure)).toEqual(['1 h', '2 h', '3 h'])
    expect(bars[0]).toMatchObject({ total: 10, acceptesPct: 25, refusPct: 0 })
    expect(bars[1]).toMatchObject({ total: 40, acceptesPct: 75, refusPct: 25 })
    expect(bars[2]).toMatchObject({ total: 0, acceptesPct: 0, refusPct: 0 })
  })

  it('journée sans trafic : aucune division par zéro', () => {
    const bars = trafficBars([hour('1 h'), hour('2 h')])
    expect(bars.every(b => b.acceptesPct === 0 && b.refusPct === 0)).toBe(true)
  })

  it('liste vide → aucune barre', () => {
    expect(trafficBars([])).toEqual([])
  })

  it('fichier réel : 24 barres, la dernière heure est la plus chargée (rebonds de spam)', () => {
    const bars = trafficBars(fixture.activite.heures)
    expect(bars).toHaveLength(24)
    const last = bars[23]!
    expect(last).toMatchObject({ heure: '13 h', acceptes: 3, refus: 193, total: 196 })
    expect(last.acceptesPct + last.refusPct).toBeCloseTo(100)
  })
})

describe('certificateTone', () => {
  it('plus de 14 jours → ok ; 14 jours ou moins → attention ; expiré → panne', () => {
    expect(certificateTone(76)).toBe('ok')
    expect(certificateTone(15)).toBe('ok')
    expect(certificateTone(14)).toBe('attention')
    expect(certificateTone(1)).toBe('attention')
    expect(certificateTone(0)).toBe('panne')
    expect(certificateTone(-3)).toBe('panne')
  })
  it('date d’expiration inconnue → attention', () => {
    expect(certificateTone(null)).toBe('attention')
  })
})

describe('diskTone', () => {
  it('seuil d’alerte du serveur à 90 %, saturé à partir de 98 %', () => {
    expect(diskTone(61)).toBe('ok')
    expect(diskTone(89)).toBe('ok')
    expect(diskTone(90)).toBe('attention')
    expect(diskTone(97)).toBe('attention')
    expect(diskTone(98)).toBe('panne')
  })
})
