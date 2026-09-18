import type {
  ThreadResult,
  ComposePayload,
  DraftSaveResult,
  Folder,
  MessageDetail,
  MessagePage,
} from '#shared/types/mail'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/**
 * Client typé de l'API. Un 401 (session expirée, serveur redémarré) renvoie
 * vers /login ; les autres erreurs remontent à l'appelant.
 */
export function useMailApi() {
  const session = useUserSession()

  async function call<T>(url: string, opts: { method?: Method; query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    try {
      // Appel non typé par route : le type de retour est fourni par l'appelant (contrat shared/types).
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
    folders: () => call<Folder[]>('/api/folders'),
    messages: (folder: string, page = 1, q?: string, pageSize = 50) =>
      call<MessagePage>('/api/messages', { query: { folder, page, pageSize, q: q || undefined } }),
    message: (folder: string, uid: number) => call<MessageDetail>(`/api/messages/${uid}`, { query: { folder } }),
    attachmentUrl: (folder: string, uid: number, id: string) =>
      `/api/messages/${uid}/attachments/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`,
    setFlags: (folder: string, uids: number[], flags: { seen?: boolean; flagged?: boolean }) =>
      call<null>('/api/messages/flags', { method: 'POST', body: { folder, uids, ...flags } }),
    move: (folder: string, uids: number[], destination: string) =>
      call<null>('/api/messages/move', { method: 'POST', body: { folder, uids, destination } }),
    remove: (folder: string, uids: number[]) =>
      call<null>('/api/messages/delete', { method: 'POST', body: { folder, uids } }),
    thread: (folder: string, uid: number) => call<ThreadResult>(`/api/messages/${uid}/thread`, { query: { folder } }),
    createFolder: (name: string, parent?: string) => call<Folder>('/api/folders', { method: 'POST', body: { name, parent } }),
    renameFolder: (path: string, name: string) => call<{ path: string }>('/api/folders', { method: 'PATCH', body: { path, name } }),
    deleteFolder: (path: string) => call<null>('/api/folders', { method: 'DELETE', body: { path } }),
    send: (payload: ComposePayload) => call<null>('/api/send', { method: 'POST', body: payload }),
    saveDraft: (payload: ComposePayload) => call<DraftSaveResult>('/api/drafts', { method: 'POST', body: payload }),
    async logout() {
      await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
      await session.clear()
      await navigateTo('/login')
    },
  }
}

/** Message d'erreur lisible pour un toast. */
export function errorText(err: unknown, fallback = 'Une erreur est survenue.'): string {
  const status = statusOf(err)
  if (status === 429) return 'Trop de requêtes. Réessayez dans quelques minutes.'
  if (status === 503) return 'Le serveur de messagerie est indisponible.'
  const data = (err as { data?: { message?: unknown } } | null)?.data
  return typeof data?.message === 'string' && data.message ? data.message : fallback
}
