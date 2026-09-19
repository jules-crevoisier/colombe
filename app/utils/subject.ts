import { NO_SUBJECT } from '#shared/types/mail'
import { i18n } from '~/lib/i18n'

/** Objet affiché : la valeur sentinelle « (sans objet) » de l'API est traduite. */
export function displaySubject(subject: string): string {
  return subject === NO_SUBJECT ? i18n.global.t('common.noSubject') : subject
}
