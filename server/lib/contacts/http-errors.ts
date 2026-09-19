import { isError } from 'h3'
import { ContactEmailConflictError, ContactNotFoundError } from '../store/contacts'
import { ContactGroupConflictError, ContactGroupNotFoundError } from '../store/contact-groups'

/**
 * Traduit les erreurs métier du carnet d'adresses en réponses HTTP françaises,
 * sur le même principe que `mailError` pour les dossiers/messages.
 */
export function contactHttpError(err: unknown): never {
  if (isError(err)) throw err
  if (err instanceof ContactNotFoundError) {
    throw createError({ statusCode: 404, statusMessage: 'Contact introuvable', message: 'Contact introuvable.' })
  }
  if (err instanceof ContactEmailConflictError) {
    throw createError({ statusCode: 409, statusMessage: 'Adresse déjà utilisée', message: 'Un autre contact utilise déjà cette adresse.' })
  }
  if (err instanceof ContactGroupNotFoundError) {
    throw createError({ statusCode: 404, statusMessage: 'Groupe introuvable', message: 'Groupe introuvable.' })
  }
  if (err instanceof ContactGroupConflictError) {
    throw createError({ statusCode: 409, statusMessage: 'Nom déjà utilisé', message: 'Un groupe porte déjà ce nom.' })
  }
  throw err
}
