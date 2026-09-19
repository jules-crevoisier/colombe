/**
 * Jeu de données déterministe du backend mémoire.
 * Messages RFC 822 valides (en-têtes encodés RFC 2047, corps en base64),
 * construits de façon synchrone pour que `resetMockStore()` reste synchrone.
 */
import type { SpecialUse } from '#shared/types/mail'
import type { AppLocale } from '#shared/types/i18n'
import type { FixtureLocaleData } from './fixtures/types'
import fixturesFr from './fixtures/fr'
import fixturesEn from './fixtures/en'

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

/** Jeux de textes localisés (server/lib/mail/fixtures/{fr,en}.ts) : mêmes clés, texte traduit. */
const FIXTURES: Record<AppLocale, FixtureLocaleData> = { fr: fixturesFr, en: fixturesEn }

/**
 * `me` : identité du titulaire de la boîte (nom affiché + adresse). Par défaut le
 * compte `dev` ; le mode démo (server/lib/demo/accounts.ts) réutilise ce même jeu
 * de données en l'adressant au compte visiteur généré, dans la langue résolue de sa
 * requête de création (`locale`, français par défaut — comportement historique
 * inchangé pour `dev@`/`alice@`).
 */
export function devFixtures(now: number, me = 'Dev Webmail <dev@universite.example>', locale: AppLocale = 'fr'): FixtureMessage[] {
  const t = FIXTURES[locale]
  const random = rng(20260918)
  const day = 86_400_000
  const list: FixtureMessage[] = []

  for (let i = 0; i < 62; i++) {
    const topic = t.topics[Math.floor(random() * t.topics.length)] ?? t.topics[0]!
    const from = t.people[Math.floor(random() * t.people.length)] ?? t.people[0]
    list.push({
      folder: 'INBOX',
      from,
      to: me,
      subject: topic.subject,
      text: `${t.greetingOpen}\n\n${topic.body}\n\n${t.greetingClose}\n${from.split(' <')[0]}`,
      date: new Date(now - Math.floor(random() * 90 * day) - 3 * day),
      seen: random() > 0.3,
      flagged: random() > 0.85,
    })
  }

  // Messages remarquables, les plus récents.
  list.push(
    {
      folder: 'INBOX',
      from: locale === 'en' ? 'Campus Newsletter <newsletter@universite.example>' : 'Lettre du campus <newsletter@universite.example>',
      to: me,
      subject: t.newsletter.subject,
      text: t.newsletter.text,
      html: t.newsletter.html,
      date: new Date(now - 2 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: locale === 'en' ? 'Billing Department <compta@factures-urgentes.example>' : 'Service Comptabilité <compta@factures-urgentes.example>',
      to: me,
      subject: t.phishing.subject,
      html: t.phishing.html,
      date: new Date(now - 5 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: t.people[3] ?? '',
      to: me,
      subject: t.gradeReport.subject,
      text: t.gradeReport.text,
      attachments: [{ filename: t.gradeReport.filename, contentType: 'application/pdf', content: PDF }],
      date: new Date(now - 26 * 3_600_000),
      seen: false,
      flagged: true,
    },
    {
      folder: 'INBOX',
      from: t.people[2] ?? '',
      to: me,
      subject: t.logoMockup.subject,
      html: t.logoMockup.html,
      attachments: [{ filename: 'logo.png', contentType: 'image/png', content: PNG, cid: 'logo@demo' }],
      date: new Date(now - 30 * 3_600_000),
      seen: true,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: t.people[4] ?? '',
      to: me,
      cc: 'Alice Martin <alice@universite.example>',
      subject: t.longSubject.subject,
      text: t.longSubject.text,
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
      from: t.people[5] ?? '',
      to: me,
      subject: t.fieldTrip.subject,
      text: t.fieldTrip.text,
      attachments: [
        { filename: 'photo-1.png', contentType: 'image/png', content: PNG },
        { filename: 'photo-2.png', contentType: 'image/png', content: PNG_RED },
        { filename: t.fieldTrip.notesFilename, contentType: 'text/plain', content: Buffer.from(t.fieldTrip.notesContent, 'utf8') },
      ],
      date: new Date(now - 7 * 3_600_000),
      seen: false,
      flagged: false,
    },
    {
      folder: 'INBOX',
      from: t.people[1] ?? '',
      to: me,
      subject: t.meetingConfirm.subject,
      text: t.meetingConfirm.text,
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
      from: t.people[0] ?? '',
      to: me,
      subject: t.replyThread.subject,
      text: t.replyThread.text,
      html: t.replyThread.html,
      date: new Date(now - 11 * 3_600_000),
      seen: true,
      flagged: false,
    },
  )

  for (let i = 0; i < 3; i++) {
    list.push({ folder: 'INBOX.Envoyés', from: me, to: t.people[i] ?? '', subject: `Re: ${t.topics[i]?.subject ?? ''}`, text: t.sentReplyBody, date: new Date(now - (i + 1) * 2 * day), seen: true, flagged: false })
  }
  list.push({ folder: 'INBOX.Brouillons', from: me, to: t.people[0], subject: t.draft.subject, text: t.draft.text, date: new Date(now - day), seen: true, flagged: false, draft: true })
  for (let i = 0; i < 2; i++) {
    list.push({ folder: 'INBOX.Corbeille', from: t.people[6] ?? '', to: me, subject: t.trash.subject(i + 1), text: t.trash.text, date: new Date(now - (20 + i) * day), seen: true, flagged: false })
  }
  for (let i = 0; i < 3; i++) {
    list.push({ folder: 'INBOX.Projets', from: t.people[i + 1] ?? '', to: me, subject: t.projects.subject(i + 1), text: t.projects.text(i + 1), date: new Date(now - (4 + i) * day), seen: i > 0, flagged: false })
  }
  // R2 : liste de diffusion, carte de visite, sous-dossier, dossier non abonné
  list.push({
    folder: 'INBOX',
    from: t.people[7] ?? '',
    to: t.mailingList.to,
    subject: t.mailingList.subject,
    text: t.mailingList.text,
    headers: {
      'List-Id': t.mailingList.listId,
      'List-Post': t.mailingList.listPost,
    },
    date: new Date(now - 13 * 3_600_000),
    seen: false,
    flagged: false,
  })
  list.push({
    folder: 'INBOX',
    from: t.people[2] ?? '',
    to: me,
    subject: t.vcard.subject,
    text: t.vcard.text,
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
        `ORG:${t.vcard.org}`,
        `TITLE:${t.vcard.title}`,
        'END:VCARD',
        '',
      ].join('\r\n'), 'utf8'),
    }],
    date: new Date(now - 15 * 3_600_000),
    seen: true,
    flagged: false,
  })
  list.push({ folder: 'INBOX.Projets.2026', from: t.people[4] ?? '', to: me, subject: t.projectsSubfolder.subject, text: t.projectsSubfolder.text, date: new Date(now - 2 * day), seen: false, flagged: false })
  list.push({ folder: 'INBOX.Anciens cours', from: t.people[3] ?? '', to: me, subject: t.archives.subject, text: t.archives.text, date: new Date(now - 200 * day), seen: true, flagged: false })
  list.push({ folder: 'INBOX.Spam', from: t.spam.from, to: me, subject: t.spam.subject, text: t.spam.text, date: new Date(now - 3 * day), seen: false, flagged: false })
  return list
}

export function aliceFixtures(now: number): FixtureMessage[] {
  const me = 'Alice Martin <alice@universite.example>'
  const people = fixturesFr.people
  return Array.from({ length: 5 }, (_, i) => ({
    folder: 'INBOX',
    from: people[i] ?? '',
    to: me,
    subject: `Message pour Alice n°${i + 1}`,
    text: `Bonjour Alice, ceci est le message ${i + 1}.`,
    date: new Date(now - (i + 1) * 86_400_000),
    seen: i > 2,
    flagged: false,
  }))
}
