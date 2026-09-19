import type {
  ThreadResult,
  ComposePayload,
  DraftSaveResult,
  Folder,
  MessageDetail,
  MessagePage,
  MessageQuery,
  MessageSource,
  ImportResult,
  QuotaInfo,
  FolderSize,
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

  function buildMessageQuery(q: MessageQuery): Record<string, string | number | undefined> {
    const query: Record<string, string | number | undefined> = {}
    if (q.q) query.q = q.q
    if (q.fields?.length) query.fields = q.fields.join(',')
    if (q.scope) query.scope = q.scope
    if (q.unread) query.unread = '1'
    if (q.flagged) query.flagged = '1'
    if (q.unanswered) query.unanswered = '1'
    if (q.attachments) query.attachments = '1'
    if (q.since) query.since = q.since
    if (q.before) query.before = q.before
    if (q.sort) query.sort = q.sort
    if (q.order) query.order = q.order
    return query
  }

  return {
    folders: (all = false) => call<Folder[]>('/api/folders', { query: all ? { all: 1 } : undefined }),
    subscribeFolder: (path: string, subscribed: boolean) =>
      call<null>('/api/folders/subscribe', { method: 'POST', body: { path, subscribed } }),
    quota: () => call<QuotaInfo>('/api/folders/quota'),
    folderSize: (path: string) => call<FolderSize>('/api/folders/size', { query: { path } }),
    /** Déplace un dossier personnel : `parent: null` le ramène à la racine. */
    moveFolder: (path: string, parent: string | null) =>
      call<{ path: string }>('/api/folders', { method: 'PATCH', body: { path, parent } }),
    messages: (folder: string, page = 1, query?: MessageQuery, pageSize = 50) => {
      const q = query ? buildMessageQuery(query) : {}
      return call<MessagePage>('/api/messages', { query: { folder, page, pageSize, ...q } })
    },
    message: (folder: string, uid: number) => call<MessageDetail>(`/api/messages/${uid}`, { query: { folder } }),
    attachmentUrl: (folder: string, uid: number, id: string) =>
      `/api/messages/${uid}/attachments/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`,
    setFlags: (folder: string, uids: number[], flags: { seen?: boolean; flagged?: boolean }) =>
      call<null>('/api/messages/flags', { method: 'POST', body: { folder, uids, ...flags } }),
    move: (folder: string, uids: number[], destination: string) =>
      call<null>('/api/messages/move', { method: 'POST', body: { folder, uids, destination } }),
    remove: (folder: string, uids: number[]) =>
      call<null>('/api/messages/delete', { method: 'POST', body: { folder, uids } }),
    copy: (folder: string, uids: number[], destination: string) =>
      call<null>('/api/messages/copy', { method: 'POST', body: { folder, uids, destination } }),
    junk: (folder: string, uids: number[], junk: boolean) =>
      call<null>('/api/messages/junk', { method: 'POST', body: { folder, uids, junk } }),
    markFolderRead: (folder: string) =>
      call<null>('/api/folders/mark-read', { method: 'POST', body: { folder } }),
    emptyFolder: (folder: string) =>
      call<null>('/api/folders/empty', { method: 'POST', body: { folder } }),
    zipUrl: (folder: string, uids: number[]) =>
      `/api/messages/zip?folder=${encodeURIComponent(folder)}&uids=${uids.join(',')}`,
    async importEml(folder: string, files: File[]) {
      const formData = new FormData()
      formData.append('folder', folder)
      for (const file of files) {
        formData.append('files', file)
      }
      return call<ImportResult>('/api/messages/import', {
        method: 'POST',
        body: formData,
      })
    },
    source: (folder: string, uid: number) => call<MessageSource>(`/api/messages/${uid}/source`, { query: { folder } }),
    rawUrl: (folder: string, uid: number) =>
      `/api/messages/${uid}/raw?folder=${encodeURIComponent(folder)}`,
    printUrl: (folder: string, uid: number) =>
      `/api/messages/${uid}/print?folder=${encodeURIComponent(folder)}`,
    attachmentsZipUrl: (folder: string, uid: number) =>
      `/api/messages/${uid}/attachments.zip?folder=${encodeURIComponent(folder)}`,
    redirect: (folder: string, uid: number, to: string[]) =>
      call<null>(`/api/messages/${uid}/redirect`, { method: 'POST', body: { folder, to } }),
    sendMdn: (folder: string, uid: number) =>
      call<null>(`/api/messages/${uid}/mdn`, { method: 'POST', body: { folder } }),
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
