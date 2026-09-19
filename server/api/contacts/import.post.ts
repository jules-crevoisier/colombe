import { mergeImportedContact } from '../../lib/store/contacts'
import { parseVCards } from '../../lib/contacts/vcard'
import { parseContactsCsv } from '../../lib/contacts/csv'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { ContactImportResult } from '#shared/types/mail'

const MAX_SIZE = 5 * 1024 * 1024
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Import .vcf ou .csv (R2.3). Une vCard sans aucune adresse e-mail est
 * ignorée (impossible à rattacher/fusionner). Une fiche fusionnée avec un
 * contact existant compte comme importée : voir le commentaire de
 * `mergeImportedContact` pour la justification.
 */
export default defineEventHandler(async (event): Promise<ContactImportResult> => {
  const { email: owner } = await requireMail(event)
  const db = useDb()

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: 'Fichier requis', message: 'Fichier requis.' })
  }

  const file = formData.find(f => f.name === 'file')
  if (!file || !file.data || !file.data.length) {
    throw createError({ statusCode: 400, statusMessage: 'Fichier requis', message: 'Fichier requis.' })
  }
  if (file.data.length > MAX_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'Trop volumineux', message: 'Le fichier dépasse 5 Mo.' })
  }

  const filename = (file.filename ?? '').toLowerCase()
  const contentType = (file.type ?? '').toLowerCase()
  const isVcf = filename.endsWith('.vcf') || contentType.includes('vcard')
  const isCsv = filename.endsWith('.csv') || contentType.includes('csv')
  if (!isVcf && !isCsv) {
    throw createError({ statusCode: 400, statusMessage: 'Format non pris en charge', message: 'Seuls les fichiers .vcf ou .csv sont acceptés.' })
  }

  const content = file.data.toString('utf-8')
  let imported = 0
  let skipped = 0

  if (isVcf) {
    for (const card of parseVCards(content)) {
      if (!card.emails.length) {
        skipped++
        continue
      }
      mergeImportedContact(db, owner, card)
      imported++
    }
  }
  else {
    for (const row of parseContactsCsv(content)) {
      const address = row.email.trim().toLowerCase()
      if (!EMAIL_RE.test(address)) {
        skipped++
        continue
      }
      mergeImportedContact(db, owner, {
        firstName: row.firstName,
        lastName: row.lastName,
        displayName: '',
        emails: [{ label: 'other', address }],
        phones: row.phone ? [{ label: 'other', number: row.phone }] : [],
        organization: row.organization,
        jobTitle: '',
        birthday: null,
      })
      imported++
    }
  }

  return { imported, skipped }
})
