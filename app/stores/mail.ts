import { defineStore } from 'pinia'
import type { Folder, SpecialUse } from '#shared/types/mail'

/** Dossiers et compteurs, partagés entre la barre latérale, la liste et la lecture. */
export const useMailStore = defineStore('mail', {
  state: () => ({
    folders: [] as Folder[],
    loaded: false,
    loading: false,
    error: false,
    /** Incrémenté à chaque changement poussé par le serveur (SSE) : la liste ouverte se recharge. */
    liveTick: 0,
    liveFolder: '',
  }),

  getters: {
    byPath: state => (path: string) => state.folders.find(f => f.path === path),
    special: state => (use: SpecialUse) => state.folders.find(f => f.specialUse === use),
    inboxUnread: state => state.folders.find(f => f.specialUse === 'inbox')?.unread ?? 0,
  },

  actions: {
    async loadFolders() {
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
