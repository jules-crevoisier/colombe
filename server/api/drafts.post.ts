import type { DraftSaveResult } from '#shared/types/mail'
import { listUserFolders } from '../lib/mail/user-folders'
import { MailError } from '../lib/mail/backend'
import { buildRawMessage } from '../lib/mail/compose'
import { draftSchema, toPayload } from '../lib/session/compose-schema'
import { mailError, requireMail } from '../utils/mail-session'
import { useDb } from '../lib/store/db'
import { findIdentity, getDefaultIdentity } from '../lib/store/identities'

export default defineEventHandler(async (event): Promise<DraftSaveResult> => {
  try {
    const payload = toPayload(await readValidatedBody(event, b => draftSchema.parse(b)))
    const { email, backend } = await requireMail(event)
    const db = useDb()

    // Identité d'envoi (R2.1), pour que le brouillon reflète le « De » choisi.
    const identity = payload.identityId != null ? findIdentity(db, email, payload.identityId) : getDefaultIdentity(db, email)
    if (!identity) {
      throw createError({ statusCode: 400, statusMessage: 'Identité invalide', message: 'Cette identité n\'existe pas.' })
    }

    const drafts = (await listUserFolders(backend, email)).find(f => f.specialUse === 'drafts')
    if (!drafts) throw new MailError('NOT_FOUND', 'Dossier Brouillons introuvable')

    // Un brouillon garde ses images en `data:` (pas de convertInlineImages) : voir compose.ts.
    const raw = await buildRawMessage(email, payload, { keepBcc: true, fromName: identity.name || undefined, replyTo: identity.replyTo || undefined })
    const uid = await backend.append(drafts.path, raw, ['\\Draft', '\\Seen'])

    // Le nouveau brouillon est en place avant de supprimer l'ancien : aucune perte possible.
    if (payload.draftUid && payload.draftUid !== uid) {
      await backend.expunge(drafts.path, [payload.draftUid]).catch((err: unknown) => {
        if (!(err instanceof MailError)) throw err
      })
    }
    return { uid }
  }
  catch (err) {
    throw mailError(err)
  }
})
