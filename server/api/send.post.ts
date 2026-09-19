import { simpleParser } from 'mailparser'
import { listUserFolders } from '../lib/mail/user-folders'
import { MailError } from '../lib/mail/backend'
import { buildRawMessage, newMessageId } from '../lib/mail/compose'
import { sendSchema, toPayload } from '../lib/session/compose-schema'
import { sendLimiter } from '../lib/session/rate-limit'
import { mailError, requireMail } from '../utils/mail-session'
import { recordRecipients } from '../lib/store/contacts'
import { useDb } from '../lib/store/db'
import { findIdentity, getDefaultIdentity } from '../lib/store/identities'

export default defineEventHandler(async (event) => {
  try {
    const payload = toPayload(await readValidatedBody(event, b => sendSchema.parse(b)))
    const { email, backend } = await requireMail(event)
    const db = useDb()

    // Identité d'envoi (R2.1) : doit appartenir à l'utilisateur, sinon la requête est invalide.
    const identity = payload.identityId != null ? findIdentity(db, email, payload.identityId) : getDefaultIdentity(db, email)
    if (!identity) {
      throw createError({ statusCode: 400, statusMessage: 'Identité invalide', message: 'Cette identité n\'existe pas.' })
    }
    // Copie cachée automatique de l'identité : ajoutée aux destinataires réels
    // (enveloppe SMTP) et à la copie « Envoyés », jamais à l'en-tête transmis.
    if (identity.bcc) payload.bcc = [...payload.bcc, identity.bcc]

    // Même limite que Postfix : un compte volé ne doit pas pouvoir relayer du spam.
    const key = `email:${email}`
    if (sendLimiter.isLimited(key)) {
      throw createError({ statusCode: 429, statusMessage: 'Limite d\'envoi atteinte', message: 'Limite d\'envoi atteinte. Réessayez plus tard.' })
    }

    // Handle forwardAsAttachment - fetch raw messages and add as message/rfc822
    if (payload.forwardAsAttachment?.length) {
      const fwdAttachments = []
      for (const fwd of payload.forwardAsAttachment) {
        const raw = await backend.getRawMessage(fwd.folder, fwd.uid)
        // Nom de fichier = objet du message transféré (pas celui du nouveau message).
        const { subject } = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true })
        const safe = (subject ?? '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
        fwdAttachments.push({
          filename: `${safe || 'message'}.eml`,
          contentType: 'message/rfc822',
          content: raw.toString('base64'),
        })
      }
      payload.attachments = [...(payload.attachments || []), ...fwdAttachments]
    }

    // L'expéditeur est toujours l'utilisateur connecté, jamais une valeur du client.
    const messageId = newMessageId(email)
    const buildOpts = {
      messageId,
      fromName: identity.name || undefined,
      replyTo: identity.replyTo || undefined,
      // Uniquement pour le message réellement transmis : jamais de `data:` en sortie (R2.1b).
      convertInlineImages: true,
    }
    const raw = await buildRawMessage(email, payload, buildOpts)
    sendLimiter.hit(key)
    await backend.send(raw, {
      from: email,
      to: [...payload.to, ...payload.cc, ...payload.bcc],
      dsn: payload.requestDeliveryReceipt,
    })

    // Le message est parti : les étapes suivantes ne doivent pas faire croire à un échec d'envoi.
    const folders = await listUserFolders(backend, email).catch(() => [])
    const sent = folders.find(f => f.specialUse === 'sent')
    if (sent) {
      const copy = await buildRawMessage(email, payload, { ...buildOpts, keepBcc: true })
      await backend.append(sent.path, copy, ['\\Seen']).catch(() => null)
    }
    const drafts = folders.find(f => f.specialUse === 'drafts')
    if (drafts && payload.draftUid) {
      await backend.expunge(drafts.path, [payload.draftUid]).catch((err: unknown) => {
        if (!(err instanceof MailError)) throw err
      })
    }

    // Set origin message flags (answered/forwarded) if specified
    if (payload.origin) {
      try {
        const flagsToAdd = payload.origin.kind === 'reply' ? ['\\Answered'] : ['$Forwarded']
        await backend.setKeywords(payload.origin.folder, [payload.origin.uid], flagsToAdd, []).catch((err: unknown) => {
          if (!(err instanceof MailError) || err.code !== 'NOT_FOUND') throw err
        })
      }
      catch {
        // Origin message may have been deleted: not a fatal error
      }
    }

    // Record recipients for auto-completion, but don't fail the send if storage fails
    try {
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
