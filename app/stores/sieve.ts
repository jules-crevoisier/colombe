import { defineStore } from 'pinia'
import type { FiltersStatus, ForwardSettings, VacationSettings } from '#shared/types/mail'

/**
 * Cache court des routes /api/filters, /api/filters/vacation et
 * /api/filters/forward : les trois sections de Paramètres → Filtres
 * (FiltersSettings, VacationSettings, ForwardSettings) montent en même
 * temps (reka-ui garde les panneaux d'onglets dans le DOM) et appelaient
 * chacune `api.status()` au montage — trois requêtes identiques. Ce store
 * partage la requête en cours entre appelants concomitants et garde le
 * résultat frais 60 s, invalidé explicitement après toute écriture.
 *
 * Ne remplace pas `app/stores/filters.ts` (état de la boîte de dialogue
 * « Nouveau filtre »), qui reste indépendant.
 */
const TTL_MS = 60_000

function isFresh(loadedAt: number): boolean {
  return loadedAt > 0 && Date.now() - loadedAt < TTL_MS
}

export const useSieveStore = defineStore('sieve', {
  state: () => ({
    status: null as FiltersStatus | null,
    statusLoadedAt: 0,
    statusPromise: null as Promise<FiltersStatus> | null,

    vacation: null as VacationSettings | null,
    vacationLoadedAt: 0,
    vacationPromise: null as Promise<VacationSettings> | null,

    forward: null as ForwardSettings | null,
    forwardLoadedAt: 0,
    forwardPromise: null as Promise<ForwardSettings> | null,
  }),

  actions: {
    /** `force: true` ignore le cache (ex. après une écriture ailleurs dans la même page). */
    loadStatus(force = false): Promise<FiltersStatus> {
      if (!force && this.status !== null && isFresh(this.statusLoadedAt)) {
        return Promise.resolve(this.status)
      }
      if (this.statusPromise) return this.statusPromise
      const promise = useFiltersApi().status()
        .then((result) => {
          this.status = result
          this.statusLoadedAt = Date.now()
          return result
        })
        .finally(() => {
          this.statusPromise = null
        })
      this.statusPromise = promise
      return promise
    },

    loadVacation(force = false): Promise<VacationSettings> {
      if (!force && this.vacation !== null && isFresh(this.vacationLoadedAt)) {
        return Promise.resolve(this.vacation)
      }
      if (this.vacationPromise) return this.vacationPromise
      const promise = useFiltersApi().vacation()
        .then((result) => {
          this.vacation = result
          this.vacationLoadedAt = Date.now()
          return result
        })
        .finally(() => {
          this.vacationPromise = null
        })
      this.vacationPromise = promise
      return promise
    },

    loadForward(force = false): Promise<ForwardSettings> {
      if (!force && this.forward !== null && isFresh(this.forwardLoadedAt)) {
        return Promise.resolve(this.forward)
      }
      if (this.forwardPromise) return this.forwardPromise
      const promise = useFiltersApi().forward()
        .then((result) => {
          this.forward = result
          this.forwardLoadedAt = Date.now()
          return result
        })
        .finally(() => {
          this.forwardPromise = null
        })
      this.forwardPromise = promise
      return promise
    },

    /** À appeler après toute écriture (règles, ensembles, réponse automatique, transfert). */
    invalidateStatus(): void {
      this.status = null
      this.statusLoadedAt = 0
    },
    invalidateVacation(): void {
      this.vacation = null
      this.vacationLoadedAt = 0
    },
    invalidateForward(): void {
      this.forward = null
      this.forwardLoadedAt = 0
    },
    invalidateAll(): void {
      this.invalidateStatus()
      this.invalidateVacation()
      this.invalidateForward()
    },
  },
})
