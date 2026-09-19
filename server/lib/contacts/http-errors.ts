import type { H3Event } from 'h3'
import { isError } from 'h3'
import { ContactEmailConflictError, ContactNotFoundError } from '../store/contacts'
import { ContactGroupConflictError, ContactGroupNotFoundError } from '../store/contact-groups'
import { serverT } from '../i18n'

/**
 * Traduit les erreurs métier du carnet d'adresses en réponses HTTP (message dans la
 * langue de la requête), sur le même principe que `mailError` pour les dossiers/messages.
 */
export function contactHttpError(err: unknown, event?: H3Event): never {
  if (isError(err)) throw err
  if (err instanceof ContactNotFoundError) {
    throw createError({ statusCode: 404, statusMessage: 'Contact introuvable', message: serverT(event, 'contacts.notFound') })
  }
  if (err instanceof ContactEmailConflictError) {
    throw createError({ statusCode: 409, statusMessage: 'Adresse déjà utilisée', message: serverT(event, 'contacts.emailConflict') })
  }
  if (err instanceof ContactGroupNotFoundError) {
    throw createError({ statusCode: 404, statusMessage: 'Groupe introuvable', message: serverT(event, 'contacts.groupNotFound') })
  }
  if (err instanceof ContactGroupConflictError) {
    throw createError({ statusCode: 409, statusMessage: 'Nom déjà utilisé', message: serverT(event, 'contacts.groupConflict') })
  }
  throw err
}
