import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { MessageDetail, MessagePage, MessageQuery, MessageSummary } from '#shared/types/mail'
import { LruMap } from '../utils/lru-map'
import { buildListCacheKey, buildMessageCacheKey } from '../utils/mail-cache-keys'

/** Taille des caches : voir CLAUDE.md — jamais persisté, mémoire uniquement. */
const LIST_CACHE_SIZE = 30
const MESSAGE_CACHE_SIZE = 50

interface ListCacheEntry {
  folder: string
  data: MessagePage
}

/**
 * Cache "stale-while-revalidate" en mémoire pour les listes de messages et
 * les détails de message. Jamais écrit dans localStorage/sessionStorage/
 * IndexedDB : vidé à la navigation hors de l'app et explicitement à la
 * déconnexion (voir `clear()`, appelé par useMailApi().logout()).
 */
export const useMailCacheStore = defineStore('mailCache', {
  state: () => ({
    lists: markRaw(new LruMap<string, ListCacheEntry>(LIST_CACHE_SIZE)),
    messages: markRaw(new LruMap<string, MessageDetail>(MESSAGE_CACHE_SIZE)),
  }),

  actions: {
    listKey(folder: string, page: number, pageSize: number, query?: MessageQuery): string {
      return buildListCacheKey(folder, page, pageSize, query)
    },

    getList(key: string): MessagePage | undefined {
      return this.lists.get(key)?.data
    },

    setList(key: string, folder: string, data: MessagePage): void {
      this.lists.set(key, { folder, data })
    },

    /** Invalide toutes les pages en cache d'un dossier (compteurs/pagination potentiellement obsolètes). */
    invalidateFolderLists(folder: string): void {
      for (const key of this.lists.keys()) {
        if (this.lists.peek(key)?.folder === folder) this.lists.delete(key)
      }
    },

    /** Invalide un dossier entièrement : ses pages de liste ET les détails de ses messages. */
    invalidateFolder(folder: string): void {
      this.invalidateFolderLists(folder)
      for (const key of this.messages.keys()) {
        if (this.messages.peek(key)?.folder === folder) this.messages.delete(key)
      }
    },

    /**
     * Met à jour lu/étoilé pour des UID donnés, dans toutes les pages en
     * cache de ce dossier et dans le cache de détail correspondant.
     */
    patchFlags(folder: string, uids: number[], patch: Partial<Pick<MessageSummary, 'seen' | 'flagged'>>): void {
      const targets = new Set(uids)
      for (const key of this.lists.keys()) {
        const entry = this.lists.peek(key)
        if (!entry || entry.folder !== folder) continue
        let changed = false
        const items = entry.data.items.map((m) => {
          if (!targets.has(m.uid)) return m
          changed = true
          return { ...m, ...patch }
        })
        if (changed) this.lists.set(key, { folder, data: { ...entry.data, items } })
      }
      for (const uid of uids) {
        const mKey = buildMessageCacheKey(folder, uid)
        const msg = this.messages.peek(mKey)
        if (msg) this.messages.set(mKey, { ...msg, ...patch })
      }
    },

    /** Fusionne des champs arbitraires dans le détail en cache (ex. senderInContacts). */
    patchMessage(folder: string, uid: number, patch: Partial<MessageDetail>): void {
      const key = buildMessageCacheKey(folder, uid)
      const msg = this.messages.peek(key)
      if (msg) this.messages.set(key, { ...msg, ...patch })
    },

    /**
     * Retire des messages des pages en cache d'un dossier (suppression,
     * déplacement, signalement spam) et supprime leur détail en cache.
     */
    removeMessages(folder: string, uids: number[]): void {
      const targets = new Set(uids)
      for (const key of this.lists.keys()) {
        const entry = this.lists.peek(key)
        if (!entry || entry.folder !== folder) continue
        const items = entry.data.items.filter(m => !targets.has(m.uid))
        const removed = entry.data.items.length - items.length
        if (removed > 0) {
          this.lists.set(key, { folder, data: { ...entry.data, items, total: Math.max(0, entry.data.total - removed) } })
        }
      }
      for (const uid of uids) this.messages.delete(buildMessageCacheKey(folder, uid))
    },

    getMessage(folder: string, uid: number): MessageDetail | undefined {
      return this.messages.get(buildMessageCacheKey(folder, uid))
    },

    setMessage(folder: string, uid: number, data: MessageDetail): void {
      this.messages.set(buildMessageCacheKey(folder, uid), data)
    },

    invalidateMessage(folder: string, uid: number): void {
      this.messages.delete(buildMessageCacheKey(folder, uid))
    },

    /** Déconnexion : purge totale (règle de sécurité — rien ne doit survivre en mémoire non plus). */
    clear(): void {
      this.lists.clear()
      this.messages.clear()
    },
  },
})
