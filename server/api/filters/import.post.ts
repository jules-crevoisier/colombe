import { importFilterSet, sieveError } from '../../lib/sieve/service'
import { requireMail } from '../../utils/mail-session'
import { serverT } from '../../lib/i18n'

const MAX_SCRIPT_BYTES = 256 * 1024

export default defineEventHandler(async (event) => {
  try {
    const { email, sid } = await requireMail(event)

    const formData = await readMultipartFormData(event)
    if (!formData) {
      throw createError({ statusCode: 400, statusMessage: 'Données invalides', message: serverT(event, 'upload.multipartRequired') })
    }

    const fileField = formData.find((f) => f.name === 'file' && f.filename)
    if (!fileField?.data) {
      throw createError({ statusCode: 400, statusMessage: 'Fichier manquant', message: serverT(event, 'filters.fileRequired') })
    }
    if (fileField.data.length > MAX_SCRIPT_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Trop volumineux', message: serverT(event, 'filters.scriptTooLarge') })
    }

    const field = (name: string): string | undefined => {
      const f = formData.find((x) => x.name === name && !x.filename)
      return f ? f.data.toString('utf-8') : undefined
    }

    const filename = fileField.filename ?? 'import.sieve'
    const content = fileField.data.toString('utf-8')

    const set = await importFilterSet(
      { event, email, sid },
      filename,
      content,
      { confirmPassword: field('confirmPassword'), totpCode: field('totpCode') }
    )
    setResponseStatus(event, 201)
    return set
  } catch (err) {
    throw sieveError(err, event)
  }
})
