import { createI18n } from 'vue-i18n'
import { bindI18n } from '../../app/lib/i18n'
import { i18nOptions } from '../../app/lib/i18n-options'

// Hors Nuxt, personne ne crée l'instance : les tests unitaires qui appellent `i18n.global.t`
// reçoivent ici la même configuration que l'application (messages, pluriel français).
bindI18n(createI18n(i18nOptions).global as never)
