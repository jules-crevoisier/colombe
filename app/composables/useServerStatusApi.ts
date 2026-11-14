import type { AdminAccess, ServerStatusResponse } from '#shared/types/server-status'

/**
 * Page « État du serveur » (administrateurs). Même politique qu'useDevicesApi :
 * un 401 renvoie vers /login ; les autres erreurs (403, 404…) sont relancées
 * pour que l'appelant les distingue avec statusOf().
 */
export function useServerStatusApi() {
  const session = useUserSession()

  async function get<T>(url: string): Promise<T> {
    try {
      const fetcher = $fetch as (url: string, init: { method: 'GET' }) => Promise<T>
      return await fetcher(url, { method: 'GET' })
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
    access: () => get<AdminAccess>('/api/admin/access'),
    status: () => get<ServerStatusResponse>('/api/admin/server-status'),
  }
}
