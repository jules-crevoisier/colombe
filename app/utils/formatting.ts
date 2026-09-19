import { i18n, intlLocale } from '~/lib/i18n'

export interface DateFormatPrefs {
  timeZone?: string
  dateFormat?: 'relative' | 'short' | 'long'
  timeFormat?: '24h' | '12h'
}

interface DateParts { day: number, month: number, year: number }

function partsInZone(date: Date, timeZone: string): DateParts {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric', month: 'numeric', year: 'numeric' })
  const values = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return { day: Number(values.day), month: Number(values.month), year: Number(values.year) }
}

/**
 * Format a message date for the list column, honouring `Prefs.dateFormat` /
 * `timeFormat` / `timeZone` (R2.5). Sans préférences (rétro-compatibilité) :
 * - Today: HH:mm
 * - This year: "12 sept."
 * - Other years: dd/mm/yyyy
 */
export function formatMessageDate(dateString: string, locale: string, prefs?: DateFormatPrefs): string {
  const { timeZone, dateFormat = 'relative', timeFormat = '24h' } = prefs ?? {}
  const hour12 = timeFormat === '12h'
  const date = new Date(dateString)

  if (dateFormat === 'short') {
    return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone })
  }
  if (dateFormat === 'long') {
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone })
  }

  const now = new Date()

  if (!timeZone) {
    // Comportement historique (UTC), conservé tel quel pour la rétro-compatibilité des tests.
    if (
      date.getUTCDate() === now.getUTCDate()
      && date.getUTCMonth() === now.getUTCMonth()
      && date.getUTCFullYear() === now.getUTCFullYear()
    ) {
      return date.toLocaleString(locale, { hour: '2-digit', minute: '2-digit', hour12 })
    }
    if (date.getUTCFullYear() === now.getUTCFullYear()) {
      return date.toLocaleString(locale, { day: 'numeric', month: 'short' })
    }
    return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
  }

  const dateParts = partsInZone(date, timeZone)
  const nowParts = partsInZone(now, timeZone)
  if (dateParts.day === nowParts.day && dateParts.month === nowParts.month && dateParts.year === nowParts.year) {
    return date.toLocaleString(locale, { hour: '2-digit', minute: '2-digit', hour12, timeZone })
  }
  if (dateParts.year === nowParts.year) {
    return date.toLocaleString(locale, { day: 'numeric', month: 'short', timeZone })
  }
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone })
}

/**
 * Date complète (en-tête de lecture, fil de discussion), honorant les mêmes préférences.
 */
export function formatFullDate(dateString: string, locale: string, prefs?: DateFormatPrefs): string {
  const { timeZone, dateFormat = 'relative', timeFormat = '24h' } = prefs ?? {}
  const hour12 = timeFormat === '12h'
  const date = new Date(dateString)

  if (dateFormat === 'short') {
    return date.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12, timeZone })
  }
  return date.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short', hour12, timeZone })
}

/**
 * Extract initials from a name.
 * E.g. "Alice Dupont" -> "AD"
 */
export function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''

  const words = trimmed.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return ''

  const firstWord = words[0]
  if (!firstWord) return ''

  if (words.length === 1) {
    return firstWord.charAt(0).toUpperCase()
  }

  const lastWord = words[words.length - 1]
  if (!lastWord) return firstWord.charAt(0).toUpperCase()

  return (firstWord.charAt(0) + lastWord.charAt(0)).toUpperCase()
}

/** Hachage stable d'une adresse (ou d'une chaîne) vers un indice de couleur. */
function avatarIndex(email: string, count: number): number {
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash) + email.charCodeAt(i)
    hash = hash & hash // entier 32 bits
  }
  return Math.abs(hash) % count
}

/**
 * Generate a deterministic avatar color class from an email or string.
 * Teintes saturées : texte blanc lisible (contraste AA). Conservé pour compatibilité ;
 * l'interface utilise getAvatarTone (encres de l'identité « Pli »).
 */
export function getAvatarColorClass(email: string): string {
  const colors = ['bg-red-700', 'bg-blue-700', 'bg-emerald-700', 'bg-amber-700', 'bg-violet-700', 'bg-pink-700'] as const
  return colors[avatarIndex(email, colors.length)] ?? 'bg-red-700'
}

/**
 * Classe d'avatar de l'identité « Pli » : six encres sourdes définies dans
 * assets/css/tailwind.css (.avatar-tone-1 … 6), texte blanc ≥ 7:1 en clair et en sombre.
 */
export function getAvatarTone(email: string): string {
  return `avatar-tone-${avatarIndex(email, 6) + 1}`
}

/**
 * Formate un volume en Go dans la langue active.
 * Ex. 1288490188 -> « 1,2 Go » (français), « 1.2 GB » (anglais).
 */
export function formatGigabytes(bytes: number): string {
  const gib = bytes / (1024 * 1024 * 1024)
  return `${gib.toLocaleString(intlLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${i18n.global.t('units.gigabyte')}`
}

/**
 * Taille d'un fichier dans la langue active : « 12 Ko » sous 1 Mo, sinon « 1,5 Mo ».
 * `minOneKb` : jamais « 0 Ko » (pièces jointes en cours d'ajout).
 */
export function formatFileSize(bytes: number, minOneKb = false): string {
  const locale = intlLocale()
  const { t } = i18n.global
  if (bytes < 1024 * 1024) {
    const kb = Math.round(bytes / 1024)
    return `${(minOneKb ? Math.max(1, kb) : kb).toLocaleString(locale, { useGrouping: false })} ${t('units.kilobyte')}`
  }
  const mb = bytes / 1024 / 1024
  return `${mb.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} ${t('units.megabyte')}`
}
