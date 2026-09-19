import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Folder, QuotaInfo } from '#shared/types/mail'
import { useMailStore } from '../../../app/stores/mail'

function folder(path: string): Folder {
  return {
    path,
    name: path,
    delimiter: '/',
    specialUse: null,
    unread: 0,
    total: 0,
    subscribed: true,
  } as Folder
}

function stubMailApi(overrides: { folders?: () => Promise<Folder[]>; quota?: () => Promise<QuotaInfo> }): void {
  vi.stubGlobal('useMailApi', () => ({
    folders: overrides.folders ?? (async () => []),
    quota: overrides.quota ?? (async () => ({ usedBytes: 0, limitBytes: 0 })),
  }))
}

describe('useMailStore loadFolders() in-flight dedupe', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('shares a single in-flight GET /api/folders across concurrent callers', async () => {
    let resolveFolders: ((v: Folder[]) => void) | null = null
    const foldersImpl = vi.fn(() => new Promise<Folder[]>((resolve) => { resolveFolders = resolve }))
    stubMailApi({ folders: foldersImpl })

    const store = useMailStore()
    // Le layout ET le panneau Filtres appellent tous deux loadFolders() au montage.
    const fromLayout = store.loadFolders()
    const fromFiltersPanel = store.loadFolders()

    expect(foldersImpl).toHaveBeenCalledTimes(1)
    resolveFolders!([folder('INBOX')])
    await Promise.all([fromLayout, fromFiltersPanel])

    expect(foldersImpl).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(true)
    expect(store.folders).toEqual([folder('INBOX')])
  })

  it('still refreshes on the next call once the in-flight request has settled (60s poll, live events)', async () => {
    const foldersImpl = vi.fn(async () => [folder('INBOX')])
    stubMailApi({ folders: foldersImpl })

    const store = useMailStore()
    await store.loadFolders()
    await store.loadFolders()

    expect(foldersImpl).toHaveBeenCalledTimes(2)
  })

  it('sets error and keeps loaded=false when the request fails', async () => {
    stubMailApi({ folders: async () => { throw new Error('offline') } })
    const store = useMailStore()

    await store.loadFolders()

    expect(store.error).toBe(true)
    expect(store.loaded).toBe(false)
  })
})

describe('useMailStore loadQuota()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches once per page load and serves the cache within the 60s TTL', async () => {
    const quotaImpl = vi.fn(async () => ({ usedBytes: 10, limitBytes: 100 }))
    stubMailApi({ quota: quotaImpl })
    const store = useMailStore()

    // FolderNav monté une fois : onMounted -> loadQuota().
    await store.loadQuota()
    // Un second montage (ex. navigation Paramètres -> Messagerie) dans la même minute
    // ne doit pas redéclencher de requête.
    await store.loadQuota()

    expect(quotaImpl).toHaveBeenCalledTimes(1)
    expect(store.quota).toEqual({ usedBytes: 10, limitBytes: 100 })
  })

  it('refetches once the TTL has expired', async () => {
    const quotaImpl = vi.fn(async () => ({ usedBytes: 10, limitBytes: 100 }))
    stubMailApi({ quota: quotaImpl })
    const store = useMailStore()

    await store.loadQuota()
    await vi.advanceTimersByTimeAsync(61_000)
    await store.loadQuota()

    expect(quotaImpl).toHaveBeenCalledTimes(2)
  })

  it('bypasses the cache when forced (folder emptied/deleted)', async () => {
    const quotaImpl = vi.fn(async () => ({ usedBytes: 10, limitBytes: 100 }))
    stubMailApi({ quota: quotaImpl })
    const store = useMailStore()

    await store.loadQuota()
    await store.loadQuota(true)

    expect(quotaImpl).toHaveBeenCalledTimes(2)
  })

  it('shares a single in-flight request across concurrent callers', async () => {
    let resolveQuota: ((v: QuotaInfo) => void) | null = null
    const quotaImpl = vi.fn(() => new Promise<QuotaInfo>((resolve) => { resolveQuota = resolve }))
    stubMailApi({ quota: quotaImpl })
    const store = useMailStore()

    const first = store.loadQuota()
    const second = store.loadQuota()
    expect(quotaImpl).toHaveBeenCalledTimes(1)

    resolveQuota!({ usedBytes: 5, limitBytes: 50 })
    await Promise.all([first, second])

    expect(quotaImpl).toHaveBeenCalledTimes(1)
  })

  it('fails silently (quota gauge just disappears) instead of throwing', async () => {
    stubMailApi({ quota: async () => { throw new Error('unavailable') } })
    const store = useMailStore()

    await expect(store.loadQuota()).resolves.toBeNull()
    expect(store.quota).toBeNull()
  })
})
