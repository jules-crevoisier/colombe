<script setup lang="ts">
import { toast } from 'vue-sonner'
import { onKeyStroke } from '@vueuse/core'
import { Archive, ArrowDownUp, ChevronLeft, ChevronRight, CircleAlert, Download, EllipsisVertical, FolderInput, ListChecks, Mail, MailOpen, RefreshCw, Search as SearchIcon, Trash2, X } from '@lucide/vue'
import type { MessagePage, MessageQuery, MessageSummary, SortKey } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const api = useMailApi()
const mail = useMailStore()
const cacheStore = useMailCacheStore()
const compose = useComposeStore()
const prefsStore = usePrefsStore()
const PAGE_SIZE_DEFAULT = 50
const pageSize = computed(() => prefsStore.prefs.pageSize ?? PAGE_SIZE_DEFAULT)
const compact = computed(() => prefsStore.prefs.density === 'compact')

const folderPath = computed(() => String(route.params.folder ?? 'INBOX'))
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''))
const sort = computed<SortKey>(() => {
  const s = route.query.sort
  return typeof s === 'string' && ['date', 'from', 'subject', 'size'].includes(s) ? s as SortKey : 'date'
})
const order = computed(() => {
  const o = route.query.order
  return typeof o === 'string' && ['asc', 'desc'].includes(o) ? o as 'asc' | 'desc' : 'desc'
})
const folder = computed(() => mail.byPath(folderPath.value))
const folderName = computed(() => (folder.value ? folderLabel(folder.value) : folderPath.value))
const isDrafts = computed(() => folder.value?.specialUse === 'drafts')
const isTrash = computed(() => folder.value?.specialUse === 'trash')
const isJunk = computed(() => folder.value?.specialUse === 'junk')
const showRecipient = computed(() => folder.value?.specialUse === 'sent' || isDrafts.value)

const data = ref<MessagePage | null>(null)
const loading = ref(true)
/** Revalidation en arrière-plan d'une page déjà affichée (depuis le cache) : indicateur discret, pas de squelette. */
const refreshing = ref(false)
const failed = ref(false)
const selected = ref(new Set<number>())
const fileInput = ref<HTMLInputElement | null>(null)
/** Clé/dossier de la page actuellement rendue dans `data`, pour distinguer navigation et revalidation. */
const loadedKey = ref<string | null>(null)

const listQuery = computed<MessageQuery>(() => ({ q: q.value || undefined, sort: sort.value, order: order.value }))
const listKey = computed(() => cacheStore.listKey(folderPath.value, page.value, pageSize.value, listQuery.value))

function syncSelection() {
  const uids = new Set((data.value?.items ?? []).map(m => m.uid))
  selected.value = new Set([...selected.value].filter(uid => uids.has(uid)))
}

/**
 * Stale-while-revalidate : si la page est en cache (ou déjà affichée pour
 * cette même clé, ex. revalidation sur événement live), on l'affiche/garde
 * sans squelette et on ne fait qu'un indicateur discret pendant le
 * rechargement en arrière-plan. Sinon, chargement classique avec squelette.
 */
async function load() {
  const key = listKey.value
  const cached = cacheStore.getList(key)
  const alreadyShown = loadedKey.value === key && data.value !== null
  if (cached && !alreadyShown) {
    data.value = cached
    loadedKey.value = key
    syncSelection()
  }
  const hasContent = cached !== undefined || alreadyShown
  if (hasContent) refreshing.value = true
  else { loading.value = true; failed.value = false }
  try {
    const fresh = await api.messages(folderPath.value, page.value, listQuery.value, pageSize.value)
    cacheStore.setList(key, folderPath.value, fresh)
    data.value = fresh
    loadedKey.value = key
    failed.value = false
    syncSelection()
  }
  catch {
    if (!hasContent) failed.value = true
    // Sinon : on garde la page déjà affichée (obsolète mais utilisable) sans interrompre l'utilisateur.
  }
  finally {
    loading.value = false
    refreshing.value = false
  }
}

// Changement poussé par le serveur (SSE) sur le dossier affiché : le cache a déjà été invalidé
// par useLiveUpdates ; on revalide juste la page visible, sans squelette.
watch(() => mail.liveTick, () => {
  if (mail.liveFolder === folderPath.value) void load()
})

/**
 * `pageSize` dépend des préférences (chargées en parallèle par le layout, en tâche
 * de fond) : si on part immédiatement avec la valeur par défaut puis que les vraies
 * préférences arrivent avec une autre taille de page, la clé de cache change et une
 * seconde requête /api/messages part juste après la première. On attend donc que
 * les préférences soient prêtes avant le tout premier chargement (le squelette est
 * déjà affiché, ça ne coûte rien à l'œil) ; `started` avale les changements réactifs
 * intermédiaires de cette attente pour ne déclencher qu'un seul appel initial.
 */
let started = false
watch([folderPath, page, q, pageSize], () => {
  if (!started) return
  selected.value = new Set()
  void load()
})

onMounted(async () => {
  if (!prefsStore.loaded) await prefsStore.load()
  started = true
  selected.value = new Set()
  void load()
})

/** Messages masqués pendant le délai d'annulation d'une suppression. */
const hidden = ref(new Set<number>())
const items = computed(() => (data.value?.items ?? []).filter(m => !hidden.value.has(m.uid)))
const total = computed(() => data.value?.total ?? 0)
const rangeLabel = computed(() => {
  if (!total.value) return ''
  const start = (page.value - 1) * pageSize.value + 1
  return t('mail.list.pagination.range', { start, end: Math.min(page.value * pageSize.value, total.value), total: total.value })
})
const lastPage = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const allState = computed<boolean | 'indeterminate'>(() => {
  if (!selected.value.size) return false
  return selected.value.size === items.value.length ? true : 'indeterminate'
})
const selection = computed(() => items.value.filter(m => selected.value.has(m.uid)))
const selectionUnread = computed(() => selection.value.some(m => !m.seen))

const moveTargets = computed(() => mail.folders.filter(f => f.path !== folderPath.value && f.specialUse !== 'drafts'))
const archive = computed(() => mail.special('archive'))

function toggleAll() {
  selected.value = allState.value === true ? new Set() : new Set(items.value.map(m => m.uid))
}
function toggle(uid: number) {
  const next = new Set(selected.value)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  selected.value = next
}

// ─── Menu de sélection (R2.7) : Tous, Aucun, Non lus, Suivis, Inverser la sélection ───
function selectAll() {
  selected.value = new Set(items.value.map(m => m.uid))
}
function selectNone() {
  selected.value = new Set()
}
function selectUnreadOnly() {
  selected.value = new Set(items.value.filter(m => !m.seen).map(m => m.uid))
}
function selectFlaggedOnly() {
  selected.value = new Set(items.value.filter(m => m.flagged).map(m => m.uid))
}
function invertSelection() {
  selected.value = new Set(items.value.filter(m => !selected.value.has(m.uid)).map(m => m.uid))
}

function goToPage(p: number) {
  void navigateTo({ query: { ...route.query, page: p > 1 ? String(p) : undefined } })
}

function messageLink(m: MessageSummary): string {
  const query = new URLSearchParams()
  if (page.value > 1) query.set('page', String(page.value))
  if (q.value) query.set('q', q.value)
  const qs = query.toString()
  return `/mail/${encodeURIComponent(folderPath.value)}/${m.uid}${qs ? `?${qs}` : ''}`
}

async function openDraft(m: MessageSummary) {
  try {
    await compose.openDraft(await api.message(folderPath.value, m.uid))
  }
  catch (err) {
    toast.error(errorText(err, t('mail.list.toasts.openDraftFailed')))
  }
}

async function run(action: () => Promise<unknown>, done: string, onSuccess?: () => void) {
  const uids = [...selected.value]
  if (!uids.length) return
  try {
    await action()
    onSuccess?.()
    toast(done)
    selected.value = new Set()
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err))
    await load()
  }
}

const markSeen = (seen: boolean) => {
  const uids = [...selected.value]
  for (const m of selection.value) m.seen = seen
  return run(
    () => api.setFlags(folderPath.value, uids, { seen }),
    seen ? t('mail.list.toasts.markedRead') : t('mail.list.toasts.markedUnread'),
    () => cacheStore.patchFlags(folderPath.value, uids, { seen }),
  )
}
/**
 * Suppression avec « Annuler » : les messages disparaissent tout de suite,
 * la requête part après 5 s. Définitive depuis la Corbeille, ou partout si
 * `deleteMode: 'permanent'` (R2.8) : confirmation, pas de délai, pas d'annulation.
 */
const permanentDeleteUids = ref<number[] | null>(null)
function removeUids(uids: number[]) {
  if (!uids.length) return
  const n = uids.length
  const source = folderPath.value
  if (folder.value?.specialUse === 'trash' || prefsStore.prefs.deleteMode === 'permanent') {
    permanentDeleteUids.value = uids
    return
  }
  hidden.value = new Set([...hidden.value, ...uids])
  selected.value = new Set()
  const unhide = () => {
    hidden.value = new Set([...hidden.value].filter(u => !uids.includes(u)))
  }
  const timer = setTimeout(async () => {
    try {
      await api.remove(source, uids)
      cacheStore.removeMessages(source, uids)
      await mail.loadFolders()
      if (source === folderPath.value) await load()
    }
    catch (err) {
      toast.error(errorText(err, t('mail.list.toasts.deleteFailed')))
    }
    finally {
      unhide()
    }
  }, 5000)
  toast(t('mail.list.toasts.trashed', { n }, n), {
    duration: 5000,
    action: {
      label: t('mail.list.toasts.undo'),
      onClick: () => {
        clearTimeout(timer)
        unhide()
      },
    },
  })
}
async function confirmPermanentDelete() {
  const uids = permanentDeleteUids.value
  permanentDeleteUids.value = null
  if (!uids?.length) return
  const source = folderPath.value
  const n = uids.length
  selected.value = new Set()
  try {
    await api.remove(source, uids)
    cacheStore.removeMessages(source, uids)
    toast(t('mail.list.toasts.deletedPermanently', { n }, n))
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err, t('mail.list.toasts.deleteFailed')))
  }
}
const removeSelected = () => removeUids([...selected.value])
const moveSelected = (destination: string, label: string) => {
  const uids = [...selected.value]
  const n = uids.length
  return run(
    () => api.move(folderPath.value, uids, destination),
    t('mail.list.toasts.moved', { n, label }, n),
    () => {
      cacheStore.removeMessages(folderPath.value, uids)
      cacheStore.invalidateFolderLists(destination)
    },
  )
}

async function toggleStar(m: MessageSummary) {
  m.flagged = !m.flagged
  try {
    await api.setFlags(folderPath.value, [m.uid], { flagged: m.flagged })
    cacheStore.patchFlags(folderPath.value, [m.uid], { flagged: m.flagged })
  }
  catch (err) {
    m.flagged = !m.flagged
    toast.error(errorText(err))
  }
}

// ─── Clavier : j/k déplacent le focus, x sélectionne, s étoile, e archive, # supprime ───
const focusedUid = ref<number | null>(null)
function focusRow(delta: number) {
  const list = items.value
  if (!list.length) return
  const idx = list.findIndex(m => m.uid === focusedUid.value)
  const next = list[Math.min(list.length - 1, Math.max(0, idx === -1 ? 0 : idx + delta))]
  if (!next) return
  focusedUid.value = next.uid
  const link = document.querySelector<HTMLAnchorElement>(`li[data-uid="${next.uid}"] a`)
  link?.focus()
  link?.scrollIntoView({ block: 'nearest' })
}
function targetUids(): number[] {
  if (selected.value.size) return [...selected.value]
  return focusedUid.value !== null ? [focusedUid.value] : []
}
function onKey(key: string, action: () => void) {
  onKeyStroke(key, (e) => {
    if (isTypingTarget(e) || compose.isOpen || compose.opening) return
    e.preventDefault()
    action()
  })
}
onKey('j', () => focusRow(1))
onKey('k', () => focusRow(-1))
onKey('x', () => {
  if (focusedUid.value !== null) toggle(focusedUid.value)
})
onKey('s', () => {
  const m = items.value.find(i => i.uid === focusedUid.value)
  if (m) void toggleStar(m)
})
onKey('e', () => {
  const uids = targetUids()
  if (archive.value && folderPath.value !== archive.value.path && uids.length) {
    selected.value = new Set(uids)
    void moveSelected(archive.value.path, folderLabel(archive.value))
  }
})
onKey('#', () => removeUids(targetUids()))
function onRowFocus(e: FocusEvent) {
  const uid = Number((e.target as HTMLElement | null)?.closest('li[data-uid]')?.getAttribute('data-uid'))
  if (uid) focusedUid.value = uid
}

function setSort(value: string) {
  const key = (['date', 'from', 'subject', 'size'] as const).find(k => k === value)
  if (key) void navigateTo({ query: { ...route.query, sort: key, page: undefined } })
}
function setOrder(value: string) {
  if (value === 'asc' || value === 'desc') void navigateTo({ query: { ...route.query, order: value, page: undefined } })
}

async function markAllAsRead() {
  try {
    await api.markFolderRead(folderPath.value)
    // Affichage immédiat (la page visible passe en « lu »), puis rechargement en arrière-plan.
    if (data.value) data.value = { ...data.value, items: data.value.items.map(m => ({ ...m, seen: true })) }
    cacheStore.invalidateFolderLists(folderPath.value)
    toast(t('mail.list.toasts.allMarkedRead'))
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err))
  }
}

async function copySelected(destination: string, label: string) {
  const uids = [...selected.value]
  const n = uids.length
  return run(
    () => api.copy(folderPath.value, uids, destination),
    t('mail.list.toasts.copied', { n, label }, n),
    () => cacheStore.invalidateFolderLists(destination),
  )
}

async function junkSelected(junk: boolean) {
  const uids = [...selected.value]
  const n = uids.length
  return run(
    () => api.junk(folderPath.value, uids, junk),
    junk ? t('mail.list.toasts.movedToJunk', { n }, n) : t('mail.list.toasts.movedToInbox', { n }, n),
    () => {
      cacheStore.removeMessages(folderPath.value, uids)
      const target = mail.special(junk ? 'junk' : 'inbox')
      if (target) cacheStore.invalidateFolderLists(target.path)
    },
  )
}

function downloadSelected() {
  const uids = [...selected.value]
  if (!uids.length) return
  const url = api.zipUrl(folderPath.value, uids)
  const a = document.createElement('a')
  a.href = url
  a.download = `messages-${new Date().toISOString().split('T')[0]}.zip`
  a.click()
}

async function importFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  try {
    const result = await api.importEml(folderPath.value, Array.from(files))
    cacheStore.invalidateFolderLists(folderPath.value)
    toast(t('mail.list.toasts.imported', { n: result.imported }, result.imported))
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err, t('mail.list.toasts.importFailed')))
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function emptyFolderConfirm() {
  try {
    await api.emptyFolder(folderPath.value)
    cacheStore.invalidateFolder(folderPath.value)
    toast(isTrash.value ? t('mail.list.toasts.trashEmptied') : t('mail.list.toasts.junkEmptied'))
    selected.value = new Set()
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err))
  }
}

// ─── Glisser-déposer vers un dossier (voir FolderNav) ───
function onDragStart(m: MessageSummary, e: DragEvent) {
  if (!e.dataTransfer) return
  const uids = selected.value.has(m.uid) ? [...selected.value] : [m.uid]
  const payload: DragPayload = { folder: folderPath.value, uids }
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

useHead({ title: computed(() => (q.value ? t('mail.list.pageTitle.search', { query: q.value }) : folderName.value)) })
</script>

<template>
  <section class="@container flex min-h-0 flex-1 flex-col" aria-labelledby="titre-dossier">
    <!-- En-tête du dossier : titre en serif, comme l'en-tête d'une lettre. -->
    <div class="flex items-baseline gap-3 px-4 pt-5 pb-1 lg:px-5">
      <h1 id="titre-dossier" class="min-w-0 truncate font-heading text-[26px] leading-tight font-medium tracking-[-0.015em] @3xl:text-[28px]">
        {{ q ? t('mail.list.header.searchResults', { query: q }) : folderName }}
      </h1>
      <span v-if="!q && folder && folder.unread > 0 && folder.specialUse !== 'drafts'" class="shrink-0 text-sm text-muted-foreground tabular-nums" aria-hidden="true">{{ t('mail.list.header.unreadCount', { n: folder.unread }, folder.unread) }}</span>
    </div>

    <!-- Barre d'outils -->
    <div class="sticky top-16 z-20 flex h-14 shrink-0 items-center gap-0.5 border-b border-border bg-surface-panel px-2 lg:static lg:h-12 lg:px-3" role="toolbar" :aria-label="t('mail.list.toolbar.ariaLabel')">
      <label class="grid size-11 cursor-pointer place-items-center rounded-lg hover:bg-accent lg:size-10">
        <span class="sr-only">{{ allState === true ? t('mail.list.toolbar.deselectAll') : t('mail.list.toolbar.selectAll') }}</span>
        <Checkbox :model-value="allState" :disabled="!items.length" @update:model-value="toggleAll" />
      </label>

      <!-- Menu de sélection (R2.7) -->
      <DropdownMenu>
        <MailMenuButton :icon="ListChecks" :label="t('mail.list.selectionMenu.label')" />
        <DropdownMenuContent align="start" class="w-48">
          <DropdownMenuItem @select="selectAll">{{ t('mail.list.selectionMenu.all') }}</DropdownMenuItem>
          <DropdownMenuItem @select="selectNone">{{ t('mail.list.selectionMenu.none') }}</DropdownMenuItem>
          <DropdownMenuItem @select="selectUnreadOnly">{{ t('mail.list.selectionMenu.unread') }}</DropdownMenuItem>
          <DropdownMenuItem @select="selectFlaggedOnly">{{ t('mail.list.selectionMenu.flagged') }}</DropdownMenuItem>
          <DropdownMenuItem @select="invertSelection">{{ t('mail.list.selectionMenu.invert') }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <template v-if="!selected.size">
        <MailIconButton :icon="RefreshCw" :label="t('mail.list.toolbar.refresh')" @click="load(); mail.loadFolders()" />
        <!-- Revalidation discrète d'une page déjà affichée (cache) : pas de squelette, juste cet indicateur. -->
        <RefreshCw v-if="refreshing" class="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        <span v-if="refreshing" class="sr-only" aria-live="polite">{{ t('mail.list.toolbar.refreshing') }}</span>
        <!-- Trier menu -->
        <DropdownMenu>
          <MailMenuButton :icon="ArrowDownUp" :label="t('mail.list.sortMenu.label')" />
          <DropdownMenuContent align="start" class="w-48">
            <DropdownMenuLabel>{{ t('mail.list.sortMenu.sortBy') }}</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="sort" @update:model-value="(v) => setSort(String(v))">
              <DropdownMenuRadioItem value="date">{{ t('mail.list.sortMenu.date') }}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="from">{{ t('mail.list.sortMenu.sender') }}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="subject">{{ t('mail.list.sortMenu.subject') }}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">{{ t('mail.list.sortMenu.size') }}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup :model-value="order" @update:model-value="(v) => setOrder(String(v))">
              <DropdownMenuRadioItem value="asc">{{ t('mail.list.sortMenu.ascending') }}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">{{ t('mail.list.sortMenu.descending') }}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- Plus d'actions menu (no selection) -->
        <DropdownMenu>
          <MailMenuButton :icon="EllipsisVertical" :label="t('mail.list.moreActions.label')" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuItem @select="markAllAsRead">
              <Mail class="size-4" aria-hidden="true" />
              {{ t('mail.list.moreActions.markAllRead') }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="fileInput?.click()">
              <span>{{ t('mail.list.moreActions.importMessages') }}</span>
            </DropdownMenuItem>
            <input
              ref="fileInput"
              type="file"
              accept=".eml,message/rfc822"
              multiple
              hidden
              @change="importFiles"
            >
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
      <template v-else>
        <span class="mx-1 grid h-6 min-w-6 place-items-center rounded-md bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums" aria-live="polite">{{ selected.size }}</span>
        <MailIconButton v-if="archive && folderPath !== archive.path" :icon="Archive" :label="t('mail.list.actions.archive')" @click="moveSelected(archive.path, folderLabel(archive))" />
        <MailIconButton :icon="Trash2" :label="folder?.specialUse === 'trash' ? t('mail.list.actions.deletePermanently') : t('mail.list.actions.delete')" @click="removeSelected" />
        <MailIconButton v-if="selectionUnread" :icon="MailOpen" :label="t('mail.list.actions.markRead')" @click="markSeen(true)" />
        <MailIconButton v-else :icon="Mail" :label="t('mail.list.actions.markUnread')" @click="markSeen(false)" />
        <!-- Plus d'actions menu (with selection) -->
        <DropdownMenu>
          <MailMenuButton :icon="EllipsisVertical" :label="t('mail.list.moreActions.label')" />
          <DropdownMenuContent align="start" class="w-56">
            <!-- Copier vers -->
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput class="size-4" aria-hidden="true" />
                {{ t('mail.list.actions.copyTo') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-48">
                <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="copySelected(f.path, folderLabel(f))">
                  {{ folderLabel(f) }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <!-- Télécharger zip -->
            <DropdownMenuItem @select="downloadSelected">
              <Download class="size-4" aria-hidden="true" />
              {{ t('mail.list.actions.downloadZip') }}
            </DropdownMenuItem>
            <!-- Signaler comme spam / Ce n'est pas un spam -->
            <DropdownMenuItem v-if="!isJunk" @select="junkSelected(true)">
              {{ t('mail.list.actions.reportSpam') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-else @select="junkSelected(false)">
              {{ t('mail.list.actions.notSpam') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <MailMenuButton :icon="FolderInput" :label="t('mail.list.actions.moveTo')" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuLabel>{{ t('mail.list.actions.moveTo') }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="moveSelected(f.path, folderLabel(f))">
              {{ folderLabel(f) }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>

      <!-- Vider la corbeille / Vider le spam button -->
      <template v-if="(isTrash || isJunk) && !selected.size">
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <button type="button" class="ml-auto h-11 rounded-lg px-3 text-sm font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:h-9">
              {{ isTrash ? t('mail.list.emptyFolder.trashAction') : t('mail.list.emptyFolder.junkAction') }}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ isTrash ? t('mail.list.emptyFolder.trashAction') : t('mail.list.emptyFolder.junkAction') }}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              {{ isTrash ? t('mail.list.emptyFolder.trashDescription') : t('mail.list.emptyFolder.junkDescription') }}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
              <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="emptyFolderConfirm">
                {{ t('mail.list.emptyFolder.confirm') }}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </template>

      <div class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <span v-if="rangeLabel" class="hidden px-2 tabular-nums sm:inline">{{ rangeLabel }}</span>
        <MailIconButton :icon="ChevronLeft" :label="t('mail.list.pagination.previous')" :disabled="page <= 1" @click="goToPage(page - 1)" />
        <MailIconButton :icon="ChevronRight" :label="t('mail.list.pagination.next')" :disabled="page >= lastPage" @click="goToPage(page + 1)" />
      </div>
    </div>

    <div v-if="q" class="flex items-center gap-2 border-b border-border bg-surface-app/50 px-4 py-1.5 text-sm">
      <SearchIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-muted-foreground" aria-live="polite">
        {{ loading ? t('mail.list.search.searching') : t('mail.list.search.resultsCount', { n: total, folder: folderName }, total) }}
      </span>
      <NuxtLink :to="`/mail/${encodeURIComponent(folderPath)}`" class="inline-flex h-11 items-center gap-1 rounded-lg px-3 font-semibold text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring lg:h-9">
        <X class="size-4" aria-hidden="true" /> {{ t('mail.list.search.clear') }}
      </NuxtLink>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
      <!-- Chargement -->
      <ul v-if="loading" aria-busy="true" :aria-label="t('mail.list.loading.ariaLabel')">
        <li v-for="n in 10" :key="n" class="flex items-center gap-3 border-b border-border px-4 py-3 @3xl:h-11 @3xl:py-0">
          <Skeleton class="size-10 shrink-0 rounded-full lg:size-4 lg:rounded" />
          <div class="flex flex-1 flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:gap-4">
            <Skeleton class="h-3.5 w-32 @3xl:w-48" />
            <Skeleton class="h-3.5 w-3/4 @3xl:flex-1" />
          </div>
        </li>
      </ul>

      <!-- Erreur -->
      <div v-else-if="failed" class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="alert">
        <CircleAlert class="size-10 text-destructive" aria-hidden="true" />
        <p class="font-heading text-xl font-medium">{{ t('mail.list.error.title') }}</p>
        <Button variant="outline" class="h-11 px-6" @click="load()">{{ t('common.retry') }}</Button>
      </div>

      <!-- Vide : la colombe, et une phrase simple. -->
      <div v-else-if="!items.length" class="flex animate-settle flex-col items-center px-6 py-16 text-center @3xl:py-24">
        <BrandDove class="mb-5 w-44 @3xl:w-52" :trail="!q" />
        <p class="font-heading text-[22px] leading-snug font-medium text-foreground">{{ q ? t('mail.list.empty.noResults') : t('mail.list.empty.allCalm') }}</p>
        <p v-if="q" class="mt-1 max-w-xs text-base text-muted-foreground">{{ t('mail.list.empty.noResultsFor', { query: q }) }}</p>
        <p v-else class="mt-1 max-w-xs text-base text-muted-foreground">{{ t('mail.list.empty.noMessages') }}</p>
      </div>

      <ul v-else :aria-label="t('mail.list.messagesAriaLabel')" @focusin="onRowFocus">
        <MailMessageRow
          v-for="m in items"
          :key="m.uid"
          :message="m"
          :to="messageLink(m)"
          :selected="selected.has(m.uid)"
          :show-recipient="showRecipient"
          :intercept-open="isDrafts"
          :compact="compact"
          @dragstart="onDragStart(m, $event)"
          @open="openDraft(m)"
          @toggle-select="toggle(m.uid)"
          @toggle-star="toggleStar(m)"
        />
      </ul>
    </div>

    <!-- Suppression définitive (Corbeille, ou deleteMode: 'permanent' partout — R2.8) -->
    <AlertDialog :open="permanentDeleteUids !== null" @update:open="(v: boolean) => { if (!v) permanentDeleteUids = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('mail.list.permanentDelete.title') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('mail.list.permanentDelete.description', { n: permanentDeleteUids?.length ?? 0 }, permanentDeleteUids?.length ?? 0) }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-lg">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmPermanentDelete">{{ t('common.delete') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
