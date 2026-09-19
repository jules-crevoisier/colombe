import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { MessageDetail, MessagePage, MessageSummary } from '#shared/types/mail'
import { useMailCacheStore } from '../../../app/stores/cache'
import { LruMap } from '../../../app/utils/lru-map'
import { buildListCacheKey, buildMessageCacheKey } from '../../../app/utils/mail-cache-keys'

function summary(uid: number, overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid,
    folder: 'INBOX',
    subject: `Sujet ${uid}`,
    from: { name: '', address: 'a@b.fr' },
    to: [],
    date: '2026-09-19T10:00:00.000Z',
    seen: false,
    flagged: false,
    hasAttachments: false,
    preview: '',
    size: 100,
    answered: false,
    forwarded: false,
    priority: 'normal',
    ...overrides,
  }
}

function page(items: MessageSummary[], total = items.length): MessagePage {
  return { items, total, page: 1, pageSize: 50 }
}

function detail(uid: number, folder = 'INBOX', overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    ...summary(uid, { folder }),
    cc: [],
    bcc: [],
    replyTo: [],
    messageId: null,
    inReplyTo: null,
    references: [],
    html: '<p>corps</p>',
    text: 'corps',
    remoteImages: 0,
    attachments: [],
    readReceiptTo: null,
    listPost: null,
    senderInContacts: false,
    ...overrides,
  } as MessageDetail
}

describe('LruMap', () => {
  it('evicts the least recently used entry once maxSize is exceeded', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4) // 'a' is oldest, should be evicted
    expect(cache.has('a')).toBe(false)
    expect(cache.size).toBe(3)
    expect([...cache.keys()]).toEqual(['b', 'c', 'd'])
  })

  it('get() refreshes recency so a recently read entry survives eviction', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // 'a' becomes most recently used
    cache.set('c', 3) // 'b' is now oldest, evicted instead of 'a'
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })

  it('peek() reads without disturbing LRU order', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.peek('a')
    cache.set('c', 3) // 'a' is still oldest (peek did not refresh it)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
  })

  it('re-setting an existing key moves it to the most-recent position', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10)
    cache.set('c', 3) // 'b' is oldest now, evicted
    expect(cache.has('a')).toBe(true)
    expect(cache.get('a')).toBe(10)
    expect(cache.has('b')).toBe(false)
  })

  it('rejects a maxSize below 1', () => {
    expect(() => new LruMap<string, number>(0)).toThrow()
  })
})

describe('cache keys', () => {
  it('builds the same list key regardless of query property order', () => {
    const k1 = buildListCacheKey('INBOX', 1, 50, { q: 'facture', sort: 'date', order: 'desc' })
    const k2 = buildListCacheKey('INBOX', 1, 50, { order: 'desc', sort: 'date', q: 'facture' })
    expect(k1).toBe(k2)
  })

  it('produces a different key when any relevant parameter changes', () => {
    const base = buildListCacheKey('INBOX', 1, 50, { q: 'facture', sort: 'date', order: 'desc' })
    expect(buildListCacheKey('Archive', 1, 50, { q: 'facture', sort: 'date', order: 'desc' })).not.toBe(base)
    expect(buildListCacheKey('INBOX', 2, 50, { q: 'facture', sort: 'date', order: 'desc' })).not.toBe(base)
    expect(buildListCacheKey('INBOX', 1, 25, { q: 'facture', sort: 'date', order: 'desc' })).not.toBe(base)
    expect(buildListCacheKey('INBOX', 1, 50, { q: 'autre', sort: 'date', order: 'desc' })).not.toBe(base)
    expect(buildListCacheKey('INBOX', 1, 50, { q: 'facture', sort: 'subject', order: 'desc' })).not.toBe(base)
    expect(buildListCacheKey('INBOX', 1, 50, { q: 'facture', sort: 'date', order: 'asc' })).not.toBe(base)
  })

  it('treats an absent query the same as an empty one', () => {
    expect(buildListCacheKey('INBOX', 1, 50)).toBe(buildListCacheKey('INBOX', 1, 50, {}))
  })

  it('builds a message key from folder and uid, distinct per folder', () => {
    expect(buildMessageCacheKey('INBOX', 42)).not.toBe(buildMessageCacheKey('Archive', 42))
    expect(buildMessageCacheKey('INBOX', 42)).toBe(buildMessageCacheKey('INBOX', 42))
  })
})

describe('useMailCacheStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('round-trips a list page through set/getList', () => {
    const store = useMailCacheStore()
    const key = store.listKey('INBOX', 1, 50, { sort: 'date', order: 'desc' })
    expect(store.getList(key)).toBeUndefined()
    const data = page([summary(1), summary(2)])
    store.setList(key, 'INBOX', data)
    expect(store.getList(key)).toEqual(data)
  })

  it('evicts the oldest list entry beyond ~30 cached pages (LRU)', () => {
    const store = useMailCacheStore()
    const keys: string[] = []
    for (let i = 0; i < 31; i++) {
      const key = store.listKey('INBOX', i, 50)
      keys.push(key)
      store.setList(key, 'INBOX', page([summary(i)]))
    }
    expect(store.getList(keys[0]!)).toBeUndefined() // first page evicted
    expect(store.getList(keys[30]!)).toBeDefined()
  })

  it('invalidateFolderLists only clears entries for that folder', () => {
    const store = useMailCacheStore()
    const inboxKey = store.listKey('INBOX', 1, 50)
    const archiveKey = store.listKey('Archive', 1, 50)
    store.setList(inboxKey, 'INBOX', page([summary(1)]))
    store.setList(archiveKey, 'Archive', page([summary(2, { folder: 'Archive' })]))
    store.invalidateFolderLists('INBOX')
    expect(store.getList(inboxKey)).toBeUndefined()
    expect(store.getList(archiveKey)).toBeDefined()
  })

  it('patchFlags updates matching messages across cached list pages and the message cache', () => {
    const store = useMailCacheStore()
    const key = store.listKey('INBOX', 1, 50)
    store.setList(key, 'INBOX', page([summary(1), summary(2)]))
    store.setMessage('INBOX', 1, detail(1))
    store.patchFlags('INBOX', [1], { seen: true, flagged: true })
    const listed = store.getList(key)
    expect(listed?.items.find(m => m.uid === 1)).toMatchObject({ seen: true, flagged: true })
    expect(listed?.items.find(m => m.uid === 2)).toMatchObject({ seen: false, flagged: false })
    expect(store.getMessage('INBOX', 1)).toMatchObject({ seen: true, flagged: true })
  })

  it('patchMessage merges arbitrary fields into a cached detail without touching list pages', () => {
    const store = useMailCacheStore()
    store.setMessage('INBOX', 1, detail(1, 'INBOX', { senderInContacts: false }))
    store.patchMessage('INBOX', 1, { senderInContacts: true })
    expect(store.getMessage('INBOX', 1)?.senderInContacts).toBe(true)
  })

  it('removeMessages drops uids from cached pages, adjusts total, and deletes their detail cache', () => {
    const store = useMailCacheStore()
    const key = store.listKey('INBOX', 1, 50)
    store.setList(key, 'INBOX', page([summary(1), summary(2), summary(3)], 3))
    store.setMessage('INBOX', 1, detail(1))
    store.removeMessages('INBOX', [1, 2])
    const listed = store.getList(key)
    expect(listed?.items.map(m => m.uid)).toEqual([3])
    expect(listed?.total).toBe(1)
    expect(store.getMessage('INBOX', 1)).toBeUndefined()
  })

  it('removeMessages never drives total below zero', () => {
    const store = useMailCacheStore()
    const key = store.listKey('INBOX', 1, 50)
    store.setList(key, 'INBOX', page([summary(1)], 0))
    store.removeMessages('INBOX', [1])
    expect(store.getList(key)?.total).toBe(0)
  })

  it('invalidateFolder clears both list pages and message details for that folder only', () => {
    const store = useMailCacheStore()
    const inboxKey = store.listKey('INBOX', 1, 50)
    store.setList(inboxKey, 'INBOX', page([summary(1)]))
    store.setMessage('INBOX', 1, detail(1))
    store.setMessage('Archive', 9, detail(9, 'Archive'))
    store.invalidateFolder('INBOX')
    expect(store.getList(inboxKey)).toBeUndefined()
    expect(store.getMessage('INBOX', 1)).toBeUndefined()
    expect(store.getMessage('Archive', 9)).toBeDefined()
  })

  it('invalidateMessage removes only the targeted (folder, uid) detail', () => {
    const store = useMailCacheStore()
    store.setMessage('INBOX', 1, detail(1))
    store.setMessage('INBOX', 2, detail(2))
    store.invalidateMessage('INBOX', 1)
    expect(store.getMessage('INBOX', 1)).toBeUndefined()
    expect(store.getMessage('INBOX', 2)).toBeDefined()
  })

  it('evicts the oldest message detail beyond ~50 cached messages (LRU)', () => {
    const store = useMailCacheStore()
    for (let uid = 0; uid < 51; uid++) {
      store.setMessage('INBOX', uid, detail(uid))
    }
    expect(store.getMessage('INBOX', 0)).toBeUndefined()
    expect(store.getMessage('INBOX', 50)).toBeDefined()
  })

  it('clear() empties both caches (logout)', () => {
    const store = useMailCacheStore()
    const key = store.listKey('INBOX', 1, 50)
    store.setList(key, 'INBOX', page([summary(1)]))
    store.setMessage('INBOX', 1, detail(1))
    store.clear()
    expect(store.getList(key)).toBeUndefined()
    expect(store.getMessage('INBOX', 1)).toBeUndefined()
  })
})
