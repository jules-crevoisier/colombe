import { i18nOptions } from '../app/lib/i18n-options'

export default defineI18nConfig(() => ({ ...i18nOptions, missingWarn: import.meta.dev ?? false }))
