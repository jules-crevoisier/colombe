import type {
  FilterApplyResult,
  FilterRule,
  FilterSet,
  FiltersStatus,
  ForwardSettings,
  SecurityConfirmation,
  VacationSettings,
} from '#shared/types/mail'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Client typé des routes /api/filters/* (filtres, réponse automatique,
 * transfert — docs/dev/PLAN-v4.md section F). Même politique qu'useMailApi :
 * un 401 renvoie vers /login.
 */
export function useFiltersApi() {
  const session = useUserSession()

  async function call<T>(url: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
    try {
      const fetcher = $fetch as (url: string, init: { method: Method; body?: unknown }) => Promise<T>
      return await fetcher(url, { method: opts.method ?? 'GET', body: opts.body })
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
    status: () => call<FiltersStatus>('/api/filters'),

    // ─── Ensembles ───
    createSet: (name: string, copyFrom?: string) =>
      call<FilterSet>('/api/filters/sets', { method: 'POST', body: { name, copyFrom } }),
    getSet: (name: string) => call<FilterSet>(`/api/filters/sets/${encodeURIComponent(name)}`),
    saveSetRules: (name: string, rules: FilterRule[], confirm?: SecurityConfirmation) =>
      call<FilterSet>(`/api/filters/sets/${encodeURIComponent(name)}`, { method: 'PUT', body: { rules, ...confirm } }),
    saveSetScript: (name: string, script: string, confirm?: SecurityConfirmation) =>
      call<FilterSet>(`/api/filters/sets/${encodeURIComponent(name)}/script`, { method: 'PUT', body: { script, ...confirm } }),
    activateSet: (name: string) => call<null>(`/api/filters/sets/${encodeURIComponent(name)}/activate`, { method: 'POST' }),
    deactivate: () => call<null>('/api/filters/deactivate', { method: 'POST' }),
    deleteSet: (name: string) => call<null>(`/api/filters/sets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    exportUrl: (name: string) => apiUrl(`/api/filters/sets/${encodeURIComponent(name)}/export`),
    async importSet(file: File, confirm?: SecurityConfirmation) {
      const formData = new FormData()
      formData.append('file', file)
      if (confirm?.confirmPassword) formData.append('confirmPassword', confirm.confirmPassword)
      if (confirm?.totpCode) formData.append('totpCode', confirm.totpCode)
      return call<FilterSet>('/api/filters/import', { method: 'POST', body: formData })
    },

    // ─── Réponse automatique et transfert ───
    vacation: () => call<VacationSettings>('/api/filters/vacation'),
    saveVacation: (settings: VacationSettings, confirm?: SecurityConfirmation) =>
      call<VacationSettings>('/api/filters/vacation', { method: 'PUT', body: { ...settings, ...confirm } }),
    forward: () => call<ForwardSettings>('/api/filters/forward'),
    saveForward: (settings: ForwardSettings, confirm?: SecurityConfirmation) =>
      call<ForwardSettings>('/api/filters/forward', { method: 'PUT', body: { ...settings, ...confirm } }),

    // ─── F.2 : appliquer un filtre aux messages existants ───
    apply: (rule: FilterRule) => call<FilterApplyResult>('/api/filters/apply', { method: 'POST', body: { rule } }),
  }
}
