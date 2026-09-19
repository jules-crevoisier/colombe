import { defineStore } from 'pinia'
import type { Folder, QuotaInfo, SpecialUse } from '#shared/types/mail'

/** Durée de fraîcheur du quota : voir `loadQuota` (une fois par page, puis sur changement de dossiers). */
const QUOTA_TTL_MS = 60_000

/** Dossiers et compteurs, partagés entre la barre latérale, la liste et la lecture. */
export const useMailStore = defineStore('mail', {
  state: () => ({
    folders: [] as Folder[],
    loaded: false,
    loading: false,
    error: false,
    /** Requête en cours, partagée par tous les appelants concomitants (layout, boîte de
     * dialogue de filtre, panneaux de réglages…) : évite un GET /api/folders par appelant. */
    loadPromise: null as Promise<void> | null,
    /** Incrémenté à chaque changement poussé par le serveur (SSE) : la liste ouverte se recharge. */
    liveTick: 0,
    liveFolder: '',
    quota: null as QuotaInfo | null,
    quotaLoadedAt: 0,
    quotaPromise: null as Promise<QuotaInfo | null> | null,
  }),

  getters: {
    byPath: state => (path: string) => state.folders.find(f => f.path === path),
    special: state => (use: SpecialUse) => state.folders.find(f => f.specialUse === use),
    inboxUnread: state => state.folders.find(f => f.specialUse === 'inbox')?.unread ?? 0,
  },

  actions: {
    loadFolders(): Promise<void> {
      if (this.loadPromise) return this.loadPromise
      const promise = this.fetchFolders().finally(() => {
        this.loadPromise = null
      })
      this.loadPromise = promise
      return promise
    },

    async fetchFolders(): Promise<void> {
      this.loading = true
      try {
        this.folders = await useMailApi().folders()
        this.error = false
        this.loaded = true
      }
      catch {
        this.error = true
      }
      finally {
        this.loading = false
      }
    },

    /**
     * Quota d'espace disque (R2.4) : une fois par ouverture de page (TTL 60 s), et à la
     * demande sur un changement de dossiers (`force: true`, ex. dossier vidé/supprimé).
     * Échec silencieux (la jauge se contente de disparaître) : jamais une erreur bloquante.
     */
    async loadQuota(force = false): Promise<QuotaInfo | null> {
      if (!force && this.quota !== null && Date.now() - this.quotaLoadedAt < QUOTA_TTL_MS) {
        return this.quota
      }
      if (this.quotaPromise) return this.quotaPromise
      const promise = this.fetchQuota().finally(() => {
        this.quotaPromise = null
      })
      this.quotaPromise = promise
      return promise
    },

    async fetchQuota(): Promise<QuotaInfo | null> {
      try {
        this.quota = await useMailApi().quota()
      }
      catch {
        this.quota = null
      }
      this.quotaLoadedAt = Date.now()
      return this.quota
    },

    notifyChange(folder: string) {
      this.liveFolder = folder
      this.liveTick += 1
    },

    /** Mise à jour optimiste du compteur de non-lus. */
    adjustUnread(path: string, delta: number) {
      const folder = this.folders.find(f => f.path === path)
      if (folder) folder.unread = Math.max(0, folder.unread + delta)
    },
  },
})
