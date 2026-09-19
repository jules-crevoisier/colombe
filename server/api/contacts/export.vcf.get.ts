import { listAllContactDetails } from '../../lib/store/contacts'
import { generateVCard } from '../../lib/contacts/vcard'
import { buildContentDisposition } from '../../lib/session/http'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

/** Export complet du carnet d'adresses en vCard 3.0 (R2.3). */
export default defineEventHandler(async (event) => {
  const { email } = await requireMail(event)
  const db = useDb()
  const contacts = listAllContactDetails(db, email)
  const vcf = generateVCard(contacts)

  setHeader(event, 'Content-Type', 'text/vcard; charset=utf-8')
  setHeader(event, 'Content-Disposition', buildContentDisposition('contacts.vcf'))
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return vcf
})
