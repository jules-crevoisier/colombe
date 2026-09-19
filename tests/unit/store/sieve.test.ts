import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FiltersStatus, ForwardSettings, VacationSettings } from '#shared/types/mail'
import { useSieveStore } from '../../../app/stores/sieve'

const STATUS: FiltersStatus = { available: true, capabilities: ['fileinto', 'vacation'], sets: [{ name: 'colombe', active: true, managed: true }] }
const VACATION: VacationSettings = {
  enabled: false, from: null, until: null, subject: '', message: '', days: 7,
  addresses: [], replyFrom: 'alice@universite.example', incoming: 'keep', incomingAddress: null,
}
const FORWARD: ForwardSettings = { enabled: false, address: '', keepCopy: true }

function stubFiltersApi(overrides: {
  status?: () => Promise<FiltersStatus>
  vacation?: () => Promise<VacationSettings>
  forward?: () => Promise<ForwardSettings>
} = {}): void {
  vi.stubGlobal('useFiltersApi', () => ({
    status: overrides.status ?? (async () => STATUS),
    vacation: overrides.vacation ?? (async () => VACATION),
    forward: overrides.forward ?? (async () => FORWARD),
  }))
}

/**
 * FiltersSettings, VacationSettings et ForwardSettings montent tous en même temps sur
 * Paramètres → Filtres (reka-ui garde les panneaux d'onglets dans le DOM) et appelaient
 * chacun `api.status()` : trois GET /api/filters identiques. Ce store les partage.
 */
describe('useSieveStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares a single in-flight GET /api/filters across the three settings sections', async () => {
    let resolveStatus: ((v: FiltersStatus) => void) | null = null
    const statusImpl = vi.fn(() => new Promise<FiltersStatus>((resolve) => { resolveStatus = resolve }))
    stubFiltersApi({ status: statusImpl })
    const store = useSieveStore()

    const fromFilters = store.loadStatus()
    const fromVacation = store.loadStatus()
    const fromForward = store.loadStatus()
    expect(statusImpl).toHaveBeenCalledTimes(1)

    resolveStatus!(STATUS)
    const results = await Promise.all([fromFilters, fromVacation, fromForward])

    expect(statusImpl).toHaveBeenCalledTimes(1)
    expect(results).toEqual([STATUS, STATUS, STATUS])
  })

  it('serves status from cache within the TTL, independently of vacation/forward', async () => {
    const statusImpl = vi.fn(async () => STATUS)
    const vacationImpl = vi.fn(async () => VACATION)
    stubFiltersApi({ status: statusImpl, vacation: vacationImpl })
    const store = useSieveStore()

    await store.loadStatus()
    await store.loadStatus()
    await store.loadVacation()
    await store.loadVacation()

    expect(statusImpl).toHaveBeenCalledTimes(1)
    expect(vacationImpl).toHaveBeenCalledTimes(1)
  })

  it('expires the cache after the TTL', async () => {
    vi.useFakeTimers()
    const statusImpl = vi.fn(async () => STATUS)
    stubFiltersApi({ status: statusImpl })
    const store = useSieveStore()

    await store.loadStatus()
    await vi.advanceTimersByTimeAsync(61_000)
    await store.loadStatus()

    expect(statusImpl).toHaveBeenCalledTimes(2)
  })

  it('refetches immediately after invalidateStatus() (after a write)', async () => {
    const statusImpl = vi.fn(async () => STATUS)
    stubFiltersApi({ status: statusImpl })
    const store = useSieveStore()

    await store.loadStatus()
    store.invalidateStatus()
    await store.loadStatus()

    expect(statusImpl).toHaveBeenCalledTimes(2)
  })

  it('invalidateAll() clears status, vacation and forward independently', async () => {
    const statusImpl = vi.fn(async () => STATUS)
    const vacationImpl = vi.fn(async () => VACATION)
    const forwardImpl = vi.fn(async () => FORWARD)
    stubFiltersApi({ status: statusImpl, vacation: vacationImpl, forward: forwardImpl })
    const store = useSieveStore()

    await store.loadStatus()
    await store.loadVacation()
    await store.loadForward()
    store.invalidateAll()
    await store.loadStatus()
    await store.loadVacation()
    await store.loadForward()

    expect(statusImpl).toHaveBeenCalledTimes(2)
    expect(vacationImpl).toHaveBeenCalledTimes(2)
    expect(forwardImpl).toHaveBeenCalledTimes(2)
  })
})
