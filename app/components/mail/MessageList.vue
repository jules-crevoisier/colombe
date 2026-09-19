<script setup lang="ts">
import { toast } from 'vue-sonner'
import { onKeyStroke } from '@vueuse/core'
import { Archive, ArrowDownUp, ChevronLeft, ChevronRight, CircleAlert, Download, EllipsisVertical, FolderInput, Inbox, ListChecks, Mail, MailOpen, RefreshCw, SearchX, Trash2, X } from '@lucide/vue'
import type { MessagePage, MessageQuery, MessageSummary, SortKey } from '#shared/types/mail'

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
const folderName = computed(() => folder.value?.name ?? folderPath.value)
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

watch([folderPath, page, q, pageSize], () => {
  selected.value = new Set()
  void load()
}, { immediate: true })

/** Messages masqués pendant le délai d'annulation d'une suppression. */
const hidden = ref(new Set<number>())
const items = computed(() => (data.value?.items ?? []).filter(m => !hidden.value.has(m.uid)))
const total = computed(() => data.value?.total ?? 0)
const rangeLabel = computed(() => {
  if (!total.value) return ''
  const start = (page.value - 1) * pageSize.value + 1
  return `${start}–${Math.min(page.value * pageSize.value, total.value)} sur ${total.value}`
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
    toast.error(errorText(err, 'Impossible d’ouvrir le brouillon.'))
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

function plural(n: number, word: string) {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

const markSeen = (seen: boolean) => {
  const uids = [...selected.value]
  for (const m of selection.value) m.seen = seen
  return run(
    () => api.setFlags(folderPath.value, uids, { seen }),
    seen ? 'Marqué comme lu' : 'Marqué comme non lu',
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
      toast.error(errorText(err, 'La suppression a échoué.'))
    }
    finally {
      unhide()
    }
  }, 5000)
  toast(`${plural(n, 'message')} placé${n > 1 ? 's' : ''} dans la corbeille`, {
    duration: 5000,
    action: {
      label: 'Annuler',
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
    toast(`${plural(n, 'message')} supprimé${n > 1 ? 's' : ''} définitivement`)
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err, 'La suppression a échoué.'))
  }
}
const removeSelected = () => removeUids([...selected.value])
const moveSelected = (destination: string, label: string) => {
  const uids = [...selected.value]
  const n = uids.length
  return run(
    () => api.move(folderPath.value, uids, destination),
    `${plural(n, 'message')} déplacé${n > 1 ? 's' : ''} vers « ${label} »`,
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
    void moveSelected(archive.value.path, archive.value.name)
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
    toast('Tous les messages marqués comme lus')
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
    `${plural(n, 'message')} copié${n > 1 ? 's' : ''} vers « ${label} »`,
    () => cacheStore.invalidateFolderLists(destination),
  )
}

async function junkSelected(junk: boolean) {
  const uids = [...selected.value]
  const n = uids.length
  const label = junk ? 'Signaler comme spam' : 'Ce n\'est pas un spam'
  return run(
    () => api.junk(folderPath.value, uids, junk),
    junk ? `${plural(n, 'message')} déplacé${n > 1 ? 's' : ''} vers le spam` : `${plural(n, 'message')} déplacé${n > 1 ? 's' : ''} vers la boîte de réception`,
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
    toast(`${result.imported} message${result.imported > 1 ? 's' : ''} importé${result.imported > 1 ? 's' : ''}`)
    await Promise.all([load(), mail.loadFolders()])
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible d\'importer les messages.'))
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function emptyFolderConfirm() {
  try {
    await api.emptyFolder(folderPath.value)
    cacheStore.invalidateFolder(folderPath.value)
    toast(isTrash.value ? 'Corbeille vidée' : 'Spam vidé')
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

useHead({ title: computed(() => (q.value ? `Recherche « ${q.value} »` : folderName.value)) })
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" :aria-labelledby="'titre-dossier'">
    <h1 id="titre-dossier" class="px-4 pt-4 pb-1 text-xl font-medium lg:sr-only">
      {{ q ? `Résultats pour « ${q} »` : folderName }}
    </h1>

    <!-- Barre d'outils -->
    <div class="sticky top-16 z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border/60 bg-surface-panel px-2 lg:static lg:h-12 lg:px-3" role="toolbar" aria-label="Actions sur les messages">
      <label class="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-accent lg:size-10">
        <span class="sr-only">{{ allState === true ? 'Tout désélectionner' : 'Tout sélectionner' }}</span>
        <Checkbox :model-value="allState" :disabled="!items.length" @update:model-value="toggleAll" />
      </label>

      <!-- Menu de sélection (R2.7) -->
      <DropdownMenu>
        <MailMenuButton :icon="ListChecks" label="Options de sélection" />
        <DropdownMenuContent align="start" class="w-48">
          <DropdownMenuItem @select="selectAll">Tous</DropdownMenuItem>
          <DropdownMenuItem @select="selectNone">Aucun</DropdownMenuItem>
          <DropdownMenuItem @select="selectUnreadOnly">Non lus</DropdownMenuItem>
          <DropdownMenuItem @select="selectFlaggedOnly">Suivis</DropdownMenuItem>
          <DropdownMenuItem @select="invertSelection">Inverser la sélection</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <template v-if="!selected.size">
        <MailIconButton :icon="RefreshCw" label="Actualiser" @click="load(); mail.loadFolders()" />
        <!-- Revalidation discrète d'une page déjà affichée (cache) : pas de squelette, juste cet indicateur. -->
        <RefreshCw v-if="refreshing" class="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        <span v-if="refreshing" class="sr-only" aria-live="polite">Actualisation de la liste…</span>
        <!-- Trier menu -->
        <DropdownMenu>
          <MailMenuButton :icon="ArrowDownUp" label="Trier" />
          <DropdownMenuContent align="start" class="w-48">
            <DropdownMenuLabel>Trier par</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="sort" @update:model-value="(v) => setSort(String(v))">
              <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="from">Expéditeur</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="subject">Objet</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">Taille</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup :model-value="order" @update:model-value="(v) => setOrder(String(v))">
              <DropdownMenuRadioItem value="asc">Ordre croissant</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">Ordre décroissant</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- Plus d'actions menu (no selection) -->
        <DropdownMenu>
          <MailMenuButton :icon="EllipsisVertical" label="Plus d'actions" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuItem @select="markAllAsRead">
              <Mail class="size-4" aria-hidden="true" />
              Marquer tout comme lu
            </DropdownMenuItem>
            <DropdownMenuItem @select="fileInput?.click()">
              <span>Importer des messages (.eml)</span>
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
        <span class="px-1 text-sm font-medium tabular-nums" aria-live="polite">{{ selected.size }}</span>
        <MailIconButton v-if="archive && folderPath !== archive.path" :icon="Archive" label="Archiver" @click="moveSelected(archive.path, archive.name)" />
        <MailIconButton :icon="Trash2" :label="folder?.specialUse === 'trash' ? 'Supprimer définitivement' : 'Supprimer'" @click="removeSelected" />
        <MailIconButton v-if="selectionUnread" :icon="MailOpen" label="Marquer comme lu" @click="markSeen(true)" />
        <MailIconButton v-else :icon="Mail" label="Marquer comme non lu" @click="markSeen(false)" />
        <!-- Plus d'actions menu (with selection) -->
        <DropdownMenu>
          <MailMenuButton :icon="EllipsisVertical" label="Plus d'actions" />
          <DropdownMenuContent align="start" class="w-56">
            <!-- Copier vers -->
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput class="size-4" aria-hidden="true" />
                Copier vers…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-48">
                <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="copySelected(f.path, f.name)">
                  {{ f.name }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <!-- Télécharger zip -->
            <DropdownMenuItem @select="downloadSelected">
              <Download class="size-4" aria-hidden="true" />
              Télécharger (.zip)
            </DropdownMenuItem>
            <!-- Signaler comme spam / Ce n'est pas un spam -->
            <DropdownMenuItem v-if="!isJunk" @select="junkSelected(true)">
              Signaler comme spam
            </DropdownMenuItem>
            <DropdownMenuItem v-else @select="junkSelected(false)">
              Ce n'est pas un spam
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <MailMenuButton :icon="FolderInput" label="Déplacer vers" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
            <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="moveSelected(f.path, f.name)">
              {{ f.name }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>

      <!-- Vider la corbeille / Vider le spam button -->
      <template v-if="(isTrash || isJunk) && !selected.size">
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <button type="button" class="ml-auto h-10 rounded-full px-4 text-sm font-medium text-destructive hover:bg-accent">
              {{ isTrash ? 'Vider la corbeille' : 'Vider le spam' }}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ isTrash ? 'Vider la corbeille' : 'Vider le spam' }}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              Cette action supprimera définitivement tous les messages de {{ isTrash ? 'la corbeille' : 'le dossier spam' }}.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="emptyFolderConfirm">
                Vider
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </template>

      <div class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <span v-if="rangeLabel" class="hidden px-2 tabular-nums sm:inline">{{ rangeLabel }}</span>
        <MailIconButton :icon="ChevronLeft" label="Page précédente" :disabled="page <= 1" @click="goToPage(page - 1)" />
        <MailIconButton :icon="ChevronRight" label="Page suivante" :disabled="page >= lastPage" @click="goToPage(page + 1)" />
      </div>
    </div>

    <div v-if="q" class="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-sm">
      <span class="min-w-0 flex-1 truncate" aria-live="polite">
        {{ loading ? 'Recherche…' : `${total} résultat${total > 1 ? 's' : ''} dans ${folderName}` }}
      </span>
      <NuxtLink :to="`/mail/${encodeURIComponent(folderPath)}`" class="inline-flex h-9 items-center gap-1 rounded-full px-3 font-medium text-primary hover:bg-accent">
        <X class="size-4" aria-hidden="true" /> Effacer
      </NuxtLink>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
      <!-- Chargement -->
      <ul v-if="loading" aria-busy="true" aria-label="Chargement des messages">
        <li v-for="n in 10" :key="n" class="flex items-center gap-3 border-b border-border/60 px-4 py-3 lg:h-10 lg:py-0">
          <Skeleton class="size-10 shrink-0 rounded-full lg:size-4 lg:rounded" />
          <div class="flex flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
            <Skeleton class="h-3.5 w-32 lg:w-48" />
            <Skeleton class="h-3.5 w-3/4 lg:flex-1" />
          </div>
        </li>
      </ul>

      <!-- Erreur -->
      <div v-else-if="failed" class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="alert">
        <CircleAlert class="size-10 text-destructive" aria-hidden="true" />
        <p class="font-medium">Impossible de charger les messages.</p>
        <Button variant="outline" class="h-11 rounded-full px-6" @click="load()">Réessayer</Button>
      </div>

      <!-- Vide -->
      <div v-else-if="!items.length" class="flex flex-col items-center gap-3 px-6 py-16 text-center text-muted-foreground">
        <component :is="q ? SearchX : Inbox" class="size-12 opacity-60" aria-hidden="true" />
        <p v-if="q" class="text-base">Aucun résultat pour « {{ q }} ».</p>
        <p v-else class="text-base">Aucun message dans ce dossier.</p>
      </div>

      <ul v-else aria-label="Messages" @focusin="onRowFocus">
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
          <AlertDialogTitle>Supprimer définitivement ?</AlertDialogTitle>
          <AlertDialogDescription>
            {{ plural(permanentDeleteUids?.length ?? 0, 'message') }} {{ (permanentDeleteUids?.length ?? 0) > 1 ? 'seront supprimés' : 'sera supprimé' }} définitivement.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-full">Annuler</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-full bg-destructive text-white hover:bg-destructive/90" @click="confirmPermanentDelete">Supprimer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
