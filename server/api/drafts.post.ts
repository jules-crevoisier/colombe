import type { DraftSaveResult } from '#shared/types/mail'
import { MailError } from '../lib/mail/backend'
import { buildRawMessage } from '../lib/mail/compose'
import { draftSchema, toPayload } from '../lib/session/compose-schema'
import { mailError, requireMail } from '../utils/mail-session'

export default defineEventHandler(async (event): Promise<DraftSaveResult> => {
  try {
    const payload = toPayload(await readValidatedBody(event, b => draftSchema.parse(b)))
    const { email, backend } = await requireMail(event)

    const drafts = (await backend.listFolders()).find(f => f.specialUse === 'drafts')
    if (!drafts) throw new MailError('NOT_FOUND', 'Dossier Brouillons introuvable')

    const raw = await buildRawMessage(email, payload, { keepBcc: true })
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
