import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_PREFS } from '#shared/types/mail'
import type { Prefs } from '#shared/types/mail'
import { statusOf } from '../../../app/utils/errors'
import { usePrefsStore } from '../../../app/stores/prefs'

/**
 * `app/stores/prefs.ts` `load()` : plusieurs appelants concomitants (le layout mail
 * et la page Paramètres appellent tous deux `if (!prefs.loaded) void prefs.load()`
 * au montage) ne doivent déclencher qu'une seule requête GET /api/prefs — voir le
 * rapport de capture réseau ("prefs 2×").
 */
function stubNuxtGlobals(fetchImpl: (...args: unknown[]) => unknown): void {
  vi.stubGlobal('$fetch', fetchImpl)
  vi.stubGlobal('statusOf', statusOf)
  vi.stubGlobal('useUserSession', () => ({ clear: vi.fn(async () => undefined) }))
  vi.stubGlobal('navigateTo', vi.fn(async () => undefined))
}

describe('usePrefsStore load() in-flight dedupe', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('shares a single in-flight GET /api/prefs across concurrent callers', async () => {
    let resolveFetch: ((v: Prefs) => void) | null = null
    const fetchImpl = vi.fn(() => new Promise<Prefs>((resolve) => { resolveFetch = resolve }))
    stubNuxtGlobals(fetchImpl)

    const store = usePrefsStore()

    const fromLayout = store.load()
    const fromSettingsPage = store.load()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)

    resolveFetch!({ ...DEFAULT_PREFS, pageSize: 100 })
    await Promise.all([fromLayout, fromSettingsPage])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.prefs.pageSize).toBe(100)
  })

  it('lets every awaiter observe the same resolved prefs, success or failure', async () => {
    let rejectFetch: ((err: unknown) => void) | null = null
    const fetchImpl = vi.fn(() => new Promise<Prefs>((_resolve, reject) => { rejectFetch = reject }))
    stubNuxtGlobals(fetchImpl)

    const store = usePrefsStore()
    const first = store.load()
    const second = store.load()

    rejectFetch!({ statusCode: 500 })

    await expect(first).rejects.toBeTruthy()
    await expect(second).rejects.toBeTruthy()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(false)
  })

  it('issues a fresh request once the previous in-flight load has settled', async () => {
    const fetchImpl = vi.fn(async () => ({ ...DEFAULT_PREFS }))
    stubNuxtGlobals(fetchImpl)

    const store = usePrefsStore()
    await store.load()
    await store.load()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
