import type {
  AccountActivity,
  ActiveSession,
  CannedResponse,
  CannedResponseInput,
  Folder,
  FolderSize,
  Identity,
  IdentityInput,
  Prefs,
  QuotaInfo,
} from '#shared/types/mail'

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * Client typé des routes de paramètres (identités, réponses types, dossiers,
 * compte). Même politique qu'useMailApi : un 401 renvoie vers /login.
 */
export function useSettingsApi() {
  const session = useUserSession()

  async function call<T>(url: string, opts: { method?: Method; query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    try {
      const fetcher = $fetch as (url: string, init: { method: Method; query?: Record<string, string | number | undefined>; body?: Record<string, unknown> }) => Promise<T>
      return await fetcher(url, { method: opts.method ?? 'GET', query: opts.query, body: opts.body as Record<string, unknown> | undefined })
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
    // ─── Identités (R2.1) ───
    identities: () => call<Identity[]>('/api/identities'),
    createIdentity: (input: IdentityInput) => call<Identity>('/api/identities', { method: 'POST', body: input }),
    updateIdentity: (id: number, patch: Partial<IdentityInput>) => call<Identity>(`/api/identities/${id}`, { method: 'PATCH', body: patch }),
    deleteIdentity: (id: number) => call<null>(`/api/identities/${id}`, { method: 'DELETE' }),

    // ─── Réponses types (R2.2) ───
    responses: () => call<CannedResponse[]>('/api/responses'),
    createResponse: (input: CannedResponseInput) => call<CannedResponse>('/api/responses', { method: 'POST', body: input }),
    updateResponse: (id: number, patch: Partial<CannedResponseInput>) => call<CannedResponse>(`/api/responses/${id}`, { method: 'PATCH', body: patch }),
    deleteResponse: (id: number) => call<null>(`/api/responses/${id}`, { method: 'DELETE' }),

    // ─── Préférences ───
    prefs: () => call<Prefs>('/api/prefs'),
    savePrefs: (patch: Partial<Prefs>) => call<Prefs>('/api/prefs', { method: 'PUT', body: patch }),

    // ─── Dossiers (R2.4) ───
    allFolders: () => call<Folder[]>('/api/folders', { query: { all: 1 } }),
    subscribeFolder: (path: string, subscribed: boolean) => call<null>('/api/folders/subscribe', { method: 'POST', body: { path, subscribed } }),
    folderSize: (path: string) => call<FolderSize>('/api/folders/size', { query: { path } }),
    quota: () => call<QuotaInfo>('/api/folders/quota'),

    // ─── Compte et sécurité (R2.6) ───
    accountActivity: () => call<AccountActivity>('/api/account/activity'),
    sessions: () => call<ActiveSession[]>('/api/account/sessions'),
    revokeOtherSessions: () => call<null>('/api/account/sessions/revoke-others', { method: 'POST' }),
    revokeSession: (id: string) => call<null>(`/api/account/sessions/${id}`, { method: 'DELETE' }),
  }
}
