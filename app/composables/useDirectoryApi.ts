import type { DirectoryEntry } from '#shared/types/mail'

/**
 * Annuaire LDAP de l'établissement (GET /api/directory/search). 404 quand
 * `features.directory` est faux côté serveur — les appelants vérifient
 * `useSiteConfig().config.features.directory` avant d'appeler `search`.
 */
export function useDirectoryApi() {
  const session = useUserSession()

  async function search(q: string): Promise<DirectoryEntry[]> {
    try {
      return await $fetch<DirectoryEntry[]>('/api/directory/search', { query: { q } })
    }
    catch (err) {
      if (statusOf(err) === 401) {
        await session.clear()
        await navigateTo('/login')
      }
      throw err
    }
  }

  return { search }
}
