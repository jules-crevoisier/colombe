import { defineStore } from 'pinia'
import { toast } from 'vue-sonner'
import type { Prefs } from '#shared/types/mail'
import { DEFAULT_PREFS } from '#shared/types/mail'
import { i18n } from '~/lib/i18n'

export const usePrefsStore = defineStore('prefs', {
  state: () => ({
    prefs: { ...DEFAULT_PREFS },
    loaded: false,
    loading: false,
    /** Requête en cours, partagée par tous les appelants concomitants (layout, page
     * Paramètres, dialogues…) : évite un GET /api/prefs par appelant. */
    loadPromise: null as Promise<void> | null,
  }),

  actions: {
    load(): Promise<void> {
      if (this.loadPromise) return this.loadPromise
      const promise = this.fetchPrefs().finally(() => {
        this.loadPromise = null
      })
      this.loadPromise = promise
      return promise
    },

    async fetchPrefs(): Promise<void> {
      this.loading = true
      try {
        const fetcher = $fetch as (
          url: string,
          init: { method: 'GET' }
        ) => Promise<Prefs>
        this.prefs = await fetcher('/api/prefs', { method: 'GET' })
        this.loaded = true
      }
      catch (err) {
        if (statusOf(err) === 401) {
          const session = useUserSession()
          await session.clear()
          await navigateTo('/login')
        }
        throw err
      }
      finally {
        this.loading = false
      }
    },

    /**
     * `silent` : pas de toast (succès ou échec) — synchronisation en tâche de fond
     * (ex. la langue choisie à la connexion, recopiée comme préférence du compte),
     * plutôt qu'un changement explicitement demandé depuis Paramètres.
     */
    async save(patch: Partial<Prefs>, options: { silent?: boolean } = {}) {
      const previous = { ...this.prefs }
      const updated = { ...this.prefs, ...patch }

      // Optimistic update
      this.prefs = updated

      try {
        const fetcher = $fetch as (
          url: string,
          init: { method: 'PUT'; body: Partial<Prefs> }
        ) => Promise<Prefs>
        const result = await fetcher('/api/prefs', {
          method: 'PUT',
          body: patch,
        })
        this.prefs = result
        if (!options.silent) toast.success(i18n.global.t('common.prefsSaved'))
      }
      catch (err) {
        // Revert on error
        this.prefs = previous
        if (statusOf(err) === 401) {
          const session = useUserSession()
          await session.clear()
          await navigateTo('/login')
        }
        else if (!options.silent) {
          toast.error(errorText(err, i18n.global.t('common.prefsSaveFailed')))
        }
      }
    },
  },
})
