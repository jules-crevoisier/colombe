import type {
  Contact,
  ContactDetail,
  ContactDetailInput,
  ContactGroup,
  ContactImportResult,
  ContactSearchResult,
} from '#shared/types/mail'

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * Client typé du carnet d'adresses (docs/PLAN-v3.md R2.3). Même politique 401 que useMailApi.
 */
export function useContactsApi() {
  const session = useUserSession()

  async function call<T>(url: string, opts: { method?: Method, query?: Record<string, string | number | undefined>, body?: unknown } = {}): Promise<T> {
    try {
      const fetcher = $fetch as (url: string, init: { method: Method, query?: Record<string, string | number | undefined>, body?: unknown }) => Promise<T>
      return await fetcher(url, { method: opts.method ?? 'GET', query: opts.query, body: opts.body })
    }
    catch (err) {
      if (statusOf(err) === 401) {
        await session.clear()
        await navigateTo('/login')
      }
      throw err
    }
  }

  return {
    /**
     * Liste / recherche. `scope: 'collected'` = adresses collectées automatiquement
     * (non ajoutées à la main) ; `groupId` filtre sur un groupe.
     */
    list: (params: { q?: string, limit?: number, scope?: 'all' | 'collected', groupId?: number } = {}) =>
      call<Contact[]>('/api/contacts', {
        query: {
          q: params.q || undefined,
          limit: params.limit,
          scope: params.scope && params.scope !== 'all' ? params.scope : undefined,
          groupId: params.groupId,
        },
      }),
    /** Autocomplétion, avec groupes quand `withGroups`. */
    search: (q: string, limit = 6) => call<Contact[]>('/api/contacts', { query: { q, limit } }),
    searchWithGroups: (q: string, limit = 6) =>
      call<ContactSearchResult>('/api/contacts', { query: { q, limit, withGroups: 1 } }),
    get: (id: number) => call<ContactDetail>(`/api/contacts/${id}`),
    /**
     * Création : le contrat gelé (docs/PLAN-v3.md R2.3) n'expose que
     * `GET`/`PUT /api/contacts/:id` pour `ContactDetail`/`ContactDetailInput` ;
     * la création reste l'ancien `POST /api/contacts` (`ContactInput`).
     * On crée avec le nom affiché calculé, puis on complète aussitôt via `PUT`.
     */
    async create(input: ContactDetailInput): Promise<ContactDetail> {
      const primaryEmail = input.emails[0]?.address ?? ''
      const displayName = input.displayName || [input.firstName, input.lastName].filter(Boolean).join(' ')
      const created = await call<Contact>('/api/contacts', { method: 'POST', body: { email: primaryEmail, name: displayName } })
      return call<ContactDetail>(`/api/contacts/${created.id}`, { method: 'PUT', body: input })
    },
    /** Ajout rapide (bouton « Ajouter aux contacts » depuis un message). */
    quickAdd: (email: string, name: string) => call<Contact>('/api/contacts', { method: 'POST', body: { email, name } }),
    update: (id: number, input: ContactDetailInput) => call<ContactDetail>(`/api/contacts/${id}`, { method: 'PUT', body: input }),
    remove: (id: number) => call<null>(`/api/contacts/${id}`, { method: 'DELETE' }),
    groups: () => call<ContactGroup[]>('/api/contact-groups'),
    createGroup: (name: string) => call<ContactGroup>('/api/contact-groups', { method: 'POST', body: { name } }),
    renameGroup: (id: number, name: string) => call<ContactGroup>(`/api/contact-groups/${id}`, { method: 'PATCH', body: { name } }),
    deleteGroup: (id: number) => call<null>(`/api/contact-groups/${id}`, { method: 'DELETE' }),
    addToGroup: (groupId: number, contactIds: number[]) =>
      call<null>(`/api/contact-groups/${groupId}/members`, { method: 'POST', body: { contactIds } }),
    removeFromGroup: (groupId: number, contactIds: number[]) =>
      call<null>(`/api/contact-groups/${groupId}/members`, { method: 'DELETE', body: { contactIds } }),
    exportVcfUrl: () => apiUrl('/api/contacts/export.vcf'),
    async importFile(file: File | Blob, filename = 'contacts.vcf') {
      const formData = new FormData()
      formData.append('file', file, filename)
      return call<ContactImportResult>('/api/contacts/import', { method: 'POST', body: formData })
    },
  }
}
