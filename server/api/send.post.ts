import { MailError } from '../lib/mail/backend'
import { buildRawMessage, newMessageId } from '../lib/mail/compose'
import { sendSchema, toPayload } from '../lib/session/compose-schema'
import { sendLimiter } from '../lib/session/rate-limit'
import { mailError, requireMail } from '../utils/mail-session'
import { recordRecipients } from '../lib/store/contacts'
import { useDb } from '../lib/store/db'

export default defineEventHandler(async (event) => {
  try {
    const payload = toPayload(await readValidatedBody(event, b => sendSchema.parse(b)))
    const { email, backend } = await requireMail(event)

    // Même limite que Postfix : un compte volé ne doit pas pouvoir relayer du spam.
    const key = `email:${email}`
    if (sendLimiter.isLimited(key)) {
      throw createError({ statusCode: 429, statusMessage: 'Limite d\'envoi atteinte', message: 'Limite d\'envoi atteinte. Réessayez plus tard.' })
    }

    // L'expéditeur est toujours l'utilisateur connecté, jamais une valeur du client.
    const messageId = newMessageId(email)
    const raw = await buildRawMessage(email, payload, { messageId })
    sendLimiter.hit(key)
    await backend.send(raw, { from: email, to: [...payload.to, ...payload.cc, ...payload.bcc] })

    // Le message est parti : les étapes suivantes ne doivent pas faire croire à un échec d'envoi.
    const folders = await backend.listFolders().catch(() => [])
    const sent = folders.find(f => f.specialUse === 'sent')
    if (sent) {
      const copy = await buildRawMessage(email, payload, { messageId, keepBcc: true })
      await backend.append(sent.path, copy, ['\\Seen']).catch(() => null)
    }
    const drafts = folders.find(f => f.specialUse === 'drafts')
    if (drafts && payload.draftUid) {
      await backend.expunge(drafts.path, [payload.draftUid]).catch((err: unknown) => {
        if (!(err instanceof MailError)) throw err
      })
    }

    // Record recipients for auto-completion, but don't fail the send if storage fails
    try {
      const db = useDb()
      recordRecipients(db, email, [
        ...payload.to.map(addr => ({ email: addr })),
        ...payload.cc.map(addr => ({ email: addr })),
        ...payload.bcc.map(addr => ({ email: addr })),
      ])
    }
    catch {
      // Storage error: log but don't fail the send
    }

    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    throw mailError(err)
  }
})
