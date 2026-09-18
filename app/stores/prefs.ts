import { defineStore } from 'pinia'
import { toast } from 'vue-sonner'
import type { Prefs } from '#shared/types/mail'
import { DEFAULT_PREFS } from '#shared/types/mail'

export const usePrefsStore = defineStore('prefs', {
  state: () => ({
    prefs: { ...DEFAULT_PREFS },
    loaded: false,
    loading: false,
  }),

  actions: {
    async load() {
      this.loading = true
      try {
        const session = useUserSession()
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

    async save(patch: Partial<Prefs>) {
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
        toast.success('Préférences enregistrées')
      }
      catch (err) {
        // Revert on error
        this.prefs = previous
        if (statusOf(err) === 401) {
          const session = useUserSession()
          await session.clear()
          await navigateTo('/login')
        }
        else {
          const message =
            errorText(err, 'Impossible d\'enregistrer les préférences.')
          toast.error(message)
        }
      }
    },
  },
})
