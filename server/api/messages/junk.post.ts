import { z } from 'zod'
import { listUserFolders } from '../../lib/mail/user-folders'
import { mailError, requireMail } from '../../utils/mail-session'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.array(z.number().int().positive()).min(1).max(200),
  junk: z.boolean(),
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email, backend } = await requireMail(event)

    const folders = await listUserFolders(backend, email)
    const destination = body.junk
      ? folders.find(f => f.specialUse === 'junk')?.path
      : folders.find(f => f.specialUse === 'inbox')?.path

    if (!destination) {
      throw createError({ statusCode: 404, statusMessage: 'Dossier introuvable', message: 'Le dossier cible est introuvable' })
    }

    await backend.move(body.folder, body.uids, destination)
    setResponseStatus(event, 204)
    return null
  } catch (err: unknown) {
    throw mailError(err)
  }
})
