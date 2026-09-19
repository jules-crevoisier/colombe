<script setup lang="ts">
import { toast } from 'vue-sonner'
import { onKeyStroke, useMediaQuery } from '@vueuse/core'
import { Archive, ArrowLeft, ChevronDown, CircleAlert, Download, Eye, FileText, Image as ImageIcon, FolderInput, ImageOff, Mail, Paperclip, Reply, ReplyAll, Forward, Star, Trash2, AlertCircle, CheckCircle2, EllipsisVertical, Share2, UserPlus, ListTree, IdCard } from '@lucide/vue'
import type { Address, MessageDetail, MessageSummary } from '#shared/types/mail'

definePageMeta({ layout: 'mail' })

const route = useRoute()
const api = useMailApi()
const contactsApi = useContactsApi()
const mail = useMailStore()
const cacheStore = useMailCacheStore()
const compose = useComposeStore()
const { user } = useUserSession()
const prefsStore = usePrefsStore()
const thread = ref<MessageSummary[]>([])

/** Volet de lecture (R2.5) : la liste reste visible à droite (ou à gauche du message) à partir de 1024 px. */
const isDesktop = useMediaQuery('(min-width: 1024px)')
const isSplitView = computed(() => prefsStore.prefs.readingPane === 'right' && isDesktop.value)

const folderPath = computed(() => String(route.params.folder ?? 'INBOX'))
const uid = computed(() => Number(route.params.uid))
const folder = computed(() => mail.byPath(folderPath.value))

const msg = ref<MessageDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)
const failed = ref(false)
const showRemote = ref(false)
const showDetails = ref(false)
const showSource = ref(false)
const sourceData = ref<{ headers: Array<{ name: string; value: string }>; source: string } | null>(null)
const showAllHeaders = ref(false)
const redirectDialogOpen = ref(false)
const redirectTo = ref<string[]>([])
const previewAttachment = ref<{ filename: string; contentType: string; id: string } | null>(null)
const previewContent = ref<{ type: 'image' | 'text'; data: string } | null>(null)
const receiptDismissed = ref(false)
const showReadReceiptBanner = computed(() => !receiptDismissed.value && !!msg.value?.readReceiptTo)
const addingContact = ref(false)
const permanentDeleteConfirm = ref(false)
let markReadTimer: ReturnType<typeof setTimeout> | null = null

function cancelMarkReadTimer() {
  if (markReadTimer) clearTimeout(markReadTimer)
  markReadTimer = null
}

const backLink = computed(() => {
  const query = new URLSearchParams()
  if (typeof route.query.page === 'string') query.set('page', route.query.page)
  if (typeof route.query.q === 'string') query.set('q', route.query.q)
  const qs = query.toString()
  return `/mail/${encodeURIComponent(folderPath.value)}${qs ? `?${qs}` : ''}`
})

async function load() {
  notFound.value = false
  failed.value = false
  cancelMarkReadTimer()
  // Immuable (UID + dossier) : un détail en cache est encore valide, on ne
  // refait jamais l'appel réseau tant qu'il n'a pas été invalidé (déplacé/supprimé).
  const cached = cacheStore.getMessage(folderPath.value, uid.value)
  if (cached) {
    showDetails.value = false
    msg.value = cached
    loading.value = false
    const pref = prefsStore.prefs.remoteImages
    showRemote.value = pref === 'always' || (pref === 'contacts' && cached.senderInContacts)
    void loadThread()
    return
  }
  loading.value = true
  showRemote.value = false
  showDetails.value = false
  try {
    const wasUnread = !msg.value || msg.value.uid !== uid.value
    const fresh = await api.message(folderPath.value, uid.value)
    cacheStore.setMessage(folderPath.value, uid.value, fresh)
    msg.value = fresh
    const pref = prefsStore.prefs.remoteImages
    showRemote.value = pref === 'always' || (pref === 'contacts' && fresh.senderInContacts)
    if (wasUnread) {
      void mail.loadFolders()
      scheduleMarkRead()
    }
    void loadThread()
  }
  catch (err) {
    msg.value = null
    if (statusOf(err) === 404) notFound.value = true
    else failed.value = true
  }
  finally {
    loading.value = false
  }
}
watch([folderPath, uid], () => {
  receiptDismissed.value = false
  void load()
}, { immediate: true })

onBeforeUnmount(cancelMarkReadTimer)

/**
 * `markReadDelay` (R2.5) : 0 = immédiat, 5/10 s = après le délai, -1 = jamais
 * automatiquement. Le serveur marque déjà « lu » à la lecture (compat.) ; ce
 * minuteur pilote uniquement l'appel client une fois le backend adapté.
 */
function scheduleMarkRead() {
  const delay = prefsStore.prefs.markReadDelay
  if (delay === -1) return
  const targetUid = uid.value
  const targetFolder = folderPath.value
  markReadTimer = setTimeout(() => {
    markReadTimer = null
    void api.setFlags(targetFolder, [targetUid], { seen: true }).then(() => {
      if (msg.value && msg.value.uid === targetUid && msg.value.folder === targetFolder) msg.value.seen = true
      cacheStore.patchFlags(targetFolder, [targetUid], { seen: true })
      void mail.loadFolders()
    }).catch(() => null)
  }, delay * 1000)
}

/** Autres messages de la conversation (dossier courant + Envoyés), du plus ancien au plus récent. */
async function loadThread() {
  thread.value = []
  if (!prefsStore.prefs.conversationView) return
  try {
    const { items } = await api.thread(folderPath.value, uid.value)
    thread.value = items.filter(m => !(m.folder === folderPath.value && m.uid === uid.value))
  }
  catch {
    // La conversation est un plus : en cas d'échec, le message seul reste affiché.
  }
}
const earlier = computed(() => thread.value.filter(m => msg.value && m.date <= msg.value.date))
const later = computed(() => thread.value.filter(m => msg.value && m.date > msg.value.date))
function threadFolderName(m: MessageSummary): string | null {
  return m.folder === folderPath.value ? null : (mail.byPath(m.folder)?.name ?? m.folder)
}

// ─── Raccourcis : r répondre, a répondre à tous, f transférer, e archiver, # supprimer, u retour ───
function onKey(key: string, action: () => void) {
  onKeyStroke(key, (e) => {
    if (isTypingTarget(e) || compose.isOpen || compose.opening || !msg.value) return
    e.preventDefault()
    action()
  })
}
onKey('r', () => msg.value && compose.openReply(msg.value, user.value?.email ?? '', 'reply'))
onKey('a', () => msg.value && compose.openReply(msg.value, user.value?.email ?? '', 'replyAll'))
onKey('f', () => msg.value && compose.openForward(msg.value))
onKey('e', () => {
  void doArchive()
})
onKey('#', () => {
  void doDelete()
})
onKey('u', () => {
  void navigateTo(backLink.value)
})

const archive = computed(() => mail.special('archive'))
const moveTargets = computed(() => mail.folders.filter(f => f.path !== folderPath.value && f.specialUse !== 'drafts'))

function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address
}
function shortList(list: Address[]): string {
  const me = user.value?.email.toLowerCase()
  return list.map(a => (a.address.toLowerCase() === me ? 'moi' : (a.name || a.address))).join(', ')
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

const dateOpts = computed(() => ({ timeZone: prefsStore.prefs.timeZone, dateFormat: prefsStore.prefs.dateFormat, timeFormat: prefsStore.prefs.timeFormat }))
const fullDate = computed(() => (msg.value ? formatFullDate(msg.value.date, 'fr-FR', dateOpts.value) : ''))
const html = computed(() => (prefsStore.prefs.preferHtml ? msg.value?.html ?? null : null))

async function act(action: () => Promise<unknown>, done: string, onSuccess?: () => void) {
  try {
    await action()
    onSuccess?.()
    toast(done)
    void mail.loadFolders()
    await navigateTo(backLink.value)
  }
  catch (err) {
    toast.error(errorText(err))
  }
}

const doArchive = () => archive.value && act(
  () => api.move(folderPath.value, [uid.value], archive.value!.path),
  'Message archivé',
  () => {
    cacheStore.removeMessages(folderPath.value, [uid.value])
    cacheStore.invalidateFolderLists(archive.value!.path)
  },
)
const doDelete = () => act(
  () => api.remove(folderPath.value, [uid.value]),
  folder.value?.specialUse === 'trash' ? 'Message supprimé définitivement' : 'Message placé dans la corbeille',
  () => {
    cacheStore.removeMessages(folderPath.value, [uid.value])
    const trash = mail.special('trash')
    if (trash && folder.value?.specialUse !== 'trash') cacheStore.invalidateFolderLists(trash.path)
  },
)
/** deleteMode 'permanent' (R2.8) : confirmation avant suppression définitive, quel que soit le dossier. */
function deleteClicked() {
  if (prefsStore.prefs.deleteMode === 'permanent') permanentDeleteConfirm.value = true
  else void doDelete()
}
function confirmPermanentDelete() {
  permanentDeleteConfirm.value = false
  void doDelete()
}
/** Copie : on reste sur le message. */
async function copyTo(path: string, name: string) {
  try {
    await api.copy(folderPath.value, [uid.value], path)
    cacheStore.invalidateFolderLists(path)
    toast(`Message copié vers « ${name} »`)
    void mail.loadFolders()
  }
  catch (err) {
    toast.error(errorText(err))
  }
}
const doMove = (path: string, name: string) => act(
  () => api.move(folderPath.value, [uid.value], path),
  `Message déplacé vers « ${name} »`,
  () => {
    cacheStore.removeMessages(folderPath.value, [uid.value])
    cacheStore.invalidateFolderLists(path)
  },
)
const doUnread = () => act(
  () => api.setFlags(folderPath.value, [uid.value], { seen: false }),
  'Marqué comme non lu',
  () => cacheStore.patchFlags(folderPath.value, [uid.value], { seen: false }),
)

async function toggleStar() {
  if (!msg.value) return
  const next = !msg.value.flagged
  msg.value.flagged = next
  try {
    await api.setFlags(folderPath.value, [uid.value], { flagged: next })
    cacheStore.patchFlags(folderPath.value, [uid.value], { flagged: next })
  }
  catch (err) {
    msg.value.flagged = !next
    toast.error(errorText(err))
  }
}

const me = computed(() => user.value?.email ?? '')
const canReplyAll = computed(() => !!msg.value && (msg.value.to.length + msg.value.cc.length) > 1)

async function loadSource() {
  if (sourceData.value) return
  try {
    sourceData.value = await api.source(folderPath.value, uid.value)
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible de charger la source.'))
  }
}

async function sendMdn() {
  try {
    await api.sendMdn(folderPath.value, uid.value)
    // readReceiptTo/$MDNSent changent côté serveur : le détail en cache doit être refait, pas seulement patché.
    cacheStore.invalidateMessage(folderPath.value, uid.value)
    toast('Accusé de lecture envoyé')
    await load()
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible d\'envoyer l\'accusé.'))
  }
}

function print() {
  const url = api.printUrl(folderPath.value, uid.value)
  window.open(url, '_blank', 'noopener')
}

async function redirect() {
  if (!redirectTo.value.length) return
  try {
    await api.redirect(folderPath.value, uid.value, redirectTo.value)
    toast('Message redirigé')
    redirectDialogOpen.value = false
    await navigateTo(backLink.value)
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible de rediriger.'))
  }
}

async function forwardAsAttachment() {
  if (!msg.value) return
  await compose.openForwardAsAttachment(msg.value)
}

/** « Créer un filtre… » (docs/dev/PLAN-v4.md F « Interface ») : De = expéditeur, Objet = objet. */
function createFilterFromMessage() {
  if (!msg.value) return
  const filters = useFiltersStore()
  filters.openCreate({ from: msg.value.from?.address ?? '', subject: msg.value.subject })
}

const PREVIEWABLE_IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
function isPreviewable(contentType: string): boolean {
  return PREVIEWABLE_IMAGES.includes(contentType) || contentType === 'text/plain'
}

async function previewAttachmentFile(a: { id: string; filename: string; contentType: string }) {
  previewAttachment.value = a
  previewContent.value = null
  try {
    const url = api.attachmentUrl(folderPath.value, uid.value, a.id)
    const blob = await $fetch<Blob>(url, { responseType: 'blob' })
    if (PREVIEWABLE_IMAGES.includes(a.contentType)) {
      const dataUrl = URL.createObjectURL(blob)
      previewContent.value = { type: 'image', data: dataUrl }
    } else if (a.contentType === 'text/plain') {
      const text = await blob.text()
      previewContent.value = { type: 'text', data: text }
    }
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible de charger l\'aperçu.'))
  }
}

function closePreview() {
  if (previewContent.value?.type === 'image') {
    URL.revokeObjectURL(previewContent.value.data)
  }
  previewAttachment.value = null
  previewContent.value = null
}

function downloadAttachment(id: string, filename: string) {
  const url = api.attachmentUrl(folderPath.value, uid.value, id)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

/** Bouton « Ajouter aux contacts » (R2.3), masqué si `senderInContacts`. */
async function addSenderToContacts() {
  if (!msg.value?.from || addingContact.value) return
  addingContact.value = true
  try {
    await contactsApi.quickAdd(msg.value.from.address, msg.value.from.name)
    msg.value.senderInContacts = true
    cacheStore.patchMessage(folderPath.value, uid.value, { senderInContacts: true })
    toast.success('Contact ajouté')
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible d\'ajouter le contact.'))
  }
  finally {
    addingContact.value = false
  }
}

function isVcard(a: { filename: string, contentType: string }): boolean {
  return /\.vcf$/i.test(a.filename) || a.contentType === 'text/vcard' || a.contentType === 'text/x-vcard'
}

/** Pièce jointe .vcf : « Importer ce contact » (R2.3). */
async function importVcardAttachment(a: { id: string, filename: string, contentType: string }) {
  try {
    const url = api.attachmentUrl(folderPath.value, uid.value, a.id)
    const blob = await $fetch<Blob>(url, { responseType: 'blob' })
    const result = await contactsApi.importFile(blob, a.filename)
    toast.success(result.imported > 0 ? 'Contact importé' : 'Aucun contact importé')
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible d\'importer ce contact.'))
  }
}

async function junkSelected() {
  try {
    await api.junk(folderPath.value, [uid.value], true)
    cacheStore.removeMessages(folderPath.value, [uid.value])
    const junk = mail.special('junk')
    if (junk) cacheStore.invalidateFolderLists(junk.path)
    toast('Message signalé comme spam')
    await navigateTo(backLink.value)
  }
  catch (err) {
    toast.error(errorText(err))
  }
}

useHead({ title: computed(() => msg.value?.subject ?? 'Message') })
</script>

<template>
  <div class="flex h-full min-h-0 flex-1">
    <div v-if="isSplitView" class="flex h-full min-h-0 w-full max-w-[25rem] shrink-0 flex-col border-r border-border xl:max-w-[27rem]">
      <MailMessageList />
    </div>
    <article class="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="sujet">
    <div class="sticky top-16 z-20 flex h-14 shrink-0 items-center gap-0.5 border-b border-border bg-surface-panel px-2 lg:static lg:h-12 lg:px-3" role="toolbar" aria-label="Actions sur le message">
      <Tooltip>
        <TooltipTrigger as-child>
          <NuxtLink :to="backLink" class="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:size-10" aria-label="Retour à la liste">
            <ArrowLeft class="size-5" aria-hidden="true" />
          </NuxtLink>
        </TooltipTrigger>
        <TooltipContent>Retour à la liste</TooltipContent>
      </Tooltip>
      <template v-if="msg">
        <MailIconButton v-if="archive && folderPath !== archive.path" :icon="Archive" label="Archiver" @click="doArchive" />
        <MailIconButton :icon="Trash2" :label="folder?.specialUse === 'trash' ? 'Supprimer définitivement' : 'Supprimer'" @click="deleteClicked" />
        <MailIconButton :icon="Mail" label="Marquer comme non lu" @click="doUnread" />
        <!-- Plus d'actions menu -->
        <DropdownMenu>
          <MailMenuButton :icon="EllipsisVertical" label="Plus d'actions" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuItem @select="print">
              Imprimer
            </DropdownMenuItem>
            <DropdownMenuItem @select="showSource = true; loadSource()">
              Afficher la source
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="showAllHeaders = !showAllHeaders">
              {{ showAllHeaders ? 'Masquer' : 'Afficher' }} tous les en-têtes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <!-- Copier vers -->
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput class="size-4" aria-hidden="true" />
                Copier vers…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-48">
                <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="copyTo(f.path, f.name)">
                  {{ f.name }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <!-- Mobile : « Déplacer vers » passe dans ce menu (6 boutons ne tiennent pas en 320 px). -->
            <DropdownMenuSub>
              <DropdownMenuSubTrigger class="sm:hidden">
                <FolderInput class="size-4" aria-hidden="true" />
                Déplacer vers…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-48">
                <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="doMove(f.path, f.name)">
                  {{ f.name }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="redirectDialogOpen = true">
              <Share2 class="size-4" aria-hidden="true" />
              Rediriger…
            </DropdownMenuItem>
            <DropdownMenuItem @select="forwardAsAttachment">
              Transférer en pièce jointe
            </DropdownMenuItem>
            <DropdownMenuItem @select="junkSelected">
              Signaler comme spam
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="createFilterFromMessage">
              Créer un filtre…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <MailMenuButton :icon="FolderInput" label="Déplacer vers" class="max-sm:hidden" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
            <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="doMove(f.path, f.name)">{{ f.name }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pt-6 lg:px-8 lg:pt-8" aria-busy="true" aria-label="Chargement du message">
        <Skeleton class="h-4 w-24" />
        <Skeleton class="h-8 w-2/3" />
        <div class="flex items-center gap-3">
          <Skeleton class="size-10 rounded-full" />
          <div class="flex flex-1 flex-col gap-2"><Skeleton class="h-4 w-48" /><Skeleton class="h-3 w-32" /></div>
        </div>
        <Skeleton class="h-64 w-full rounded-lg" />
      </div>

      <div v-else-if="notFound || failed" class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="alert">
        <BrandDove class="mb-2 w-36 opacity-80" :trail="false" />
        <p class="max-w-sm font-heading text-xl leading-snug font-medium">{{ notFound ? 'Ce message n’existe plus. Il a peut-être été déplacé ou supprimé.' : 'Impossible d’afficher ce message.' }}</p>
        <div class="flex gap-2">
          <Button v-if="failed" variant="outline" class="h-11 rounded-lg px-6" @click="load">Réessayer</Button>
          <Button as-child variant="outline" class="h-11 rounded-lg px-6"><NuxtLink :to="backLink">Retour à la liste</NuxtLink></Button>
        </div>
      </div>

      <div v-else-if="msg" class="mx-auto flex w-full max-w-4xl animate-settle flex-col gap-5 px-4 pt-5 pb-4 lg:px-8 lg:pt-8">
        <div class="flex flex-col gap-2">
          <span v-if="folder" class="stamp self-start">{{ folder.name }}</span>
          <h1 id="sujet" class="min-w-0 font-heading text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance break-words lg:text-[32px]">{{ msg.subject }}</h1>
        </div>

        <div class="flex items-start gap-3 border-b border-border pb-4">
          <span class="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" :class="getAvatarTone(msg.from?.address ?? '')" aria-hidden="true">
            {{ getInitials(msg.from?.name || msg.from?.address.split('@')[0] || '?') }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span class="font-semibold">{{ msg.from?.name || msg.from?.address || '(expéditeur inconnu)' }}</span>
              <span v-if="msg.from?.name" class="truncate text-[13px] text-muted-foreground">&lt;{{ msg.from.address }}&gt;</span>
              <button
                v-if="msg.from && !msg.senderInContacts"
                type="button"
                class="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                :disabled="addingContact"
                @click="addSenderToContacts"
              >
                <UserPlus class="size-3.5" aria-hidden="true" /> Ajouter aux contacts
              </button>
            </div>
            <button type="button" class="-mx-1 inline-flex max-w-full items-center gap-1 rounded-md px-1 text-left text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" :aria-expanded="showDetails" @click="showDetails = !showDetails">
              <span class="truncate">à {{ shortList([...msg.to, ...msg.cc]) || '(aucun destinataire)' }}</span>
              <ChevronDown class="size-3.5 shrink-0 transition-transform" :class="{ 'rotate-180': showDetails }" aria-hidden="true" />
              <span class="sr-only">{{ showDetails ? 'Masquer' : 'Afficher' }} les détails</span>
            </button>
            <!-- Mobile : la date passe sous les destinataires (à droite à partir de 640 px). -->
            <time class="block text-xs text-muted-foreground sm:hidden" :datetime="msg.date">{{ fullDate }}</time>
            <dl v-if="showDetails" class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface-app/60 p-3 text-xs">
              <dt class="text-muted-foreground">De</dt><dd class="break-all">{{ msg.from ? formatAddress(msg.from) : '—' }}</dd>
              <template v-if="msg.replyTo.length"><dt class="text-muted-foreground">Répondre à</dt><dd class="break-all">{{ msg.replyTo.map(formatAddress).join(', ') }}</dd></template>
              <dt class="text-muted-foreground">À</dt><dd class="break-all">{{ msg.to.map(formatAddress).join(', ') || '—' }}</dd>
              <template v-if="msg.cc.length"><dt class="text-muted-foreground">Cc</dt><dd class="break-all">{{ msg.cc.map(formatAddress).join(', ') }}</dd></template>
              <template v-if="msg.bcc.length"><dt class="text-muted-foreground">Cci</dt><dd class="break-all">{{ msg.bcc.map(formatAddress).join(', ') }}</dd></template>
              <dt class="text-muted-foreground">Date</dt><dd>{{ fullDate }}</dd>
            </dl>
          </div>
          <time class="hidden shrink-0 pt-0.5 text-[13px] text-muted-foreground sm:block" :datetime="msg.date">{{ fullDate }}</time>
          <MailIconButton :icon="Star" :label="msg.flagged ? 'Retirer l’étoile' : 'Ajouter une étoile'" :pressed="msg.flagged" class="-mt-2 -mr-2" :class="msg.flagged ? '[&_svg]:fill-beak [&_svg]:text-beak-strong' : ''" @click="toggleStar" />
        </div>

        <p v-if="thread.length" class="-mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{{ thread.length + 1 }} messages dans cette conversation</p>
        <section v-if="earlier.length" aria-label="Messages précédents de la conversation">
          <ul class="flex flex-col">
            <MailThreadItem v-for="m in earlier" :key="`${m.folder}:${m.uid}`" :item="m" :folder-name="threadFolderName(m)" />
          </ul>
        </section>

        <div v-if="msg.remoteImages > 0 && !showRemote" class="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-surface-app/60 px-4 py-3 text-sm sm:flex-row sm:items-center" role="status">
          <ImageOff class="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
          <p class="flex-1">Les images distantes sont masquées pour protéger votre vie privée.</p>
          <Button variant="outline" class="h-11 self-start px-4 sm:h-9 sm:self-auto" @click="showRemote = true">Afficher les images</Button>
        </div>

        <!-- Read receipt banner -->
        <div v-if="showReadReceiptBanner" class="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-surface-app/60 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <AlertCircle class="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
          <p class="flex-1">L'expéditeur demande un accusé de lecture.</p>
          <div class="flex gap-2">
            <Button variant="outline" class="h-11 px-4 sm:h-9" @click="sendMdn">Envoyer l'accusé</Button>
            <Button variant="ghost" class="h-11 px-4 sm:h-9" @click="receiptDismissed = true">Ignorer</Button>
          </div>
        </div>

        <!-- La lettre : le corps du message, toujours sur papier blanc (les e-mails HTML le supposent). -->
        <div class="overflow-hidden rounded-lg border border-border bg-white shadow-sheet">
          <MailFrame :html="html" :text="msg.text" :show-remote="showRemote" />
        </div>

        <section v-if="msg.attachments.length" aria-labelledby="pj-titre" class="flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-3">
            <h2 id="pj-titre" class="flex items-center gap-2 text-sm font-semibold">
              <Paperclip class="size-4 text-muted-foreground" aria-hidden="true" />
              {{ msg.attachments.length }} pièce{{ msg.attachments.length > 1 ? 's' : '' }} jointe{{ msg.attachments.length > 1 ? 's' : '' }}
            </h2>
            <template v-if="msg.attachments.length >= 2">
              <a
                :href="api.attachmentsZipUrl(folderPath, uid)"
                :download="`${msg.subject.slice(0, 50)}-attachments.zip`"
                class="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring lg:min-h-8"
              >
                Tout télécharger (.zip)
              </a>
            </template>
          </div>
          <ul class="flex flex-wrap gap-2">
            <li v-for="a in msg.attachments" :key="a.id" class="flex max-w-full items-center gap-2">
              <!-- Aperçu uniquement pour les images et le texte (R1.3) ; le reste se télécharge. -->
              <button
                v-if="isPreviewable(a.contentType)"
                type="button"
                class="flex h-14 max-w-72 min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-panel px-3 transition-colors hover:border-line-strong hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-ring"
                :aria-label="`Aperçu de ${a.filename} (${formatSize(a.size)})`"
                @click="previewAttachmentFile(a)"
              >
                <span class="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <component :is="a.contentType.startsWith('image/') ? ImageIcon : FileText" class="size-[18px]" aria-hidden="true" />
                </span>
                <span class="flex min-w-0 flex-col text-left">
                  <span class="truncate text-sm font-medium">{{ a.filename }}</span>
                  <span class="text-xs text-muted-foreground">{{ formatSize(a.size) }}</span>
                </span>
                <Eye class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              <a
                v-else
                :href="api.attachmentUrl(folderPath, uid, a.id)"
                :download="a.filename"
                class="flex h-14 max-w-72 min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-panel px-3 transition-colors hover:border-line-strong hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span class="grid size-9 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive">
                  <FileText class="size-[18px]" aria-hidden="true" />
                </span>
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-sm font-medium">{{ a.filename }}</span>
                  <span class="text-xs text-muted-foreground">{{ formatSize(a.size) }}</span>
                </span>
                <Download class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="sr-only">Télécharger</span>
              </a>
              <Button v-if="isVcard(a)" variant="outline" class="h-11 shrink-0 px-3 text-xs lg:h-10" @click="importVcardAttachment(a)">
                <IdCard class="size-4" aria-hidden="true" /> Importer ce contact
              </Button>
            </li>
          </ul>
        </section>

        <section v-if="later.length" aria-label="Réponses suivantes de la conversation">
          <ul class="flex flex-col">
            <MailThreadItem v-for="m in later" :key="`${m.folder}:${m.uid}`" :item="m" :folder-name="threadFolderName(m)" />
          </ul>
        </section>

        <div class="flex flex-wrap gap-2 pt-1 pb-24 lg:pb-6">
          <Button class="h-11 px-5" @click="compose.openReply(msg, me, 'reply')">
            <Reply class="size-4" aria-hidden="true" /> Répondre
          </Button>
          <Button v-if="canReplyAll" variant="outline" class="h-11 rounded-lg px-5" @click="compose.openReply(msg, me, 'replyAll')">
            <ReplyAll class="size-4" aria-hidden="true" /> Répondre à tous
          </Button>
          <Button variant="outline" class="h-11 rounded-lg px-5" @click="compose.openForward(msg)">
            <Forward class="size-4" aria-hidden="true" /> Transférer
          </Button>
          <Button v-if="msg.listPost" variant="outline" class="h-11 rounded-lg px-5" @click="compose.openReply(msg, me, 'list')">
            <ListTree class="size-4" aria-hidden="true" /> Répondre à la liste
          </Button>
        </div>
      </div>
    </div>

    <!-- Source dialog -->
    <Dialog v-model:open="showSource" @update:open="open => { if (!open) { sourceData = null } }">
      <DialogContent class="flex max-h-[80dvh] flex-col gap-0">
        <DialogHeader class="border-b px-6 py-4">
          <DialogTitle>Source du message</DialogTitle>
        </DialogHeader>
        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <pre v-if="sourceData" class="whitespace-pre-wrap break-words text-xs font-mono">{{ sourceData.source }}</pre>
        </div>
        <DialogFooter class="border-t px-6 py-4">
          <Button variant="outline" @click="downloadAttachment('', msg?.messageId || 'message'); " disabled>
            <span>Vous ne pouvez pas télécharger depuis la source</span>
          </Button>
          <a v-if="msg" :href="api.rawUrl(folderPath, uid)" :download="`${msg.subject.slice(0, 50)}.eml`" hidden />
          <Button as-child>
            <a :href="api.rawUrl(folderPath, uid)" :download="`${msg?.subject.slice(0, 50) || 'message'}.eml`">
              Télécharger (.eml)
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Suppression définitive (deleteMode: 'permanent', R2.8) -->
    <AlertDialog :open="permanentDeleteConfirm" @update:open="(v: boolean) => { if (!v) permanentDeleteConfirm = false }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer définitivement ?</AlertDialogTitle>
          <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-lg">Annuler</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmPermanentDelete">Supprimer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Redirect dialog -->
    <Dialog v-model:open="redirectDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rediriger le message</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col gap-4">
          <div class="rounded-lg border px-3">
            <MailRecipientInput id="redirect-to" v-model="redirectTo" label="À" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="redirectDialogOpen = false">Annuler</Button>
          <Button @click="redirect">Rediriger</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Attachment preview dialog -->
    <Dialog :open="previewAttachment !== null" @update:open="(v: boolean) => { if (!v) previewAttachment = null }">
      <DialogContent class="flex max-h-[80dvh] flex-col gap-0">
        <DialogHeader class="border-b px-6 py-4">
          <DialogTitle>Aperçu : {{ previewAttachment?.filename }}</DialogTitle>
        </DialogHeader>
        <div class="min-h-0 flex-1 overflow-auto px-6 py-4">
          <template v-if="previewContent?.type === 'image'">
            <img :src="previewContent.data" :alt="previewAttachment?.filename" class="max-w-full" />
          </template>
          <template v-else-if="previewContent?.type === 'text'">
            <pre class="whitespace-pre-wrap break-words text-xs font-mono">{{ previewContent.data }}</pre>
          </template>
        </div>
        <DialogFooter class="border-t px-6 py-4">
          <Button variant="outline" @click="closePreview">Fermer</Button>
          <Button v-if="previewAttachment" @click="downloadAttachment(previewAttachment.id, previewAttachment.filename)">
            <Download class="size-4" aria-hidden="true" />
            Télécharger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </article>
  </div>
</template>
