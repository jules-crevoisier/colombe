<script setup lang="ts">
import { toast } from 'vue-sonner'
import { onKeyStroke } from '@vueuse/core'
import { Archive, ArrowLeft, ChevronDown, CircleAlert, Download, FileText, FolderInput, ImageOff, Mail, Paperclip, Reply, ReplyAll, Forward, Star, Trash2 } from '@lucide/vue'
import type { Address, MessageDetail, MessageSummary } from '#shared/types/mail'

definePageMeta({ layout: 'mail' })

const route = useRoute()
const api = useMailApi()
const mail = useMailStore()
const compose = useComposeStore()
const { user } = useUserSession()
const prefsStore = usePrefsStore()
const thread = ref<MessageSummary[]>([])

const folderPath = computed(() => String(route.params.folder ?? 'INBOX'))
const uid = computed(() => Number(route.params.uid))
const folder = computed(() => mail.byPath(folderPath.value))

const msg = ref<MessageDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)
const failed = ref(false)
const showRemote = ref(false)
const showDetails = ref(false)

const backLink = computed(() => {
  const query = new URLSearchParams()
  if (typeof route.query.page === 'string') query.set('page', route.query.page)
  if (typeof route.query.q === 'string') query.set('q', route.query.q)
  const qs = query.toString()
  return `/mail/${encodeURIComponent(folderPath.value)}${qs ? `?${qs}` : ''}`
})

async function load() {
  loading.value = true
  notFound.value = false
  failed.value = false
  showRemote.value = false
  showDetails.value = false
  try {
    const wasUnread = !msg.value || msg.value.uid !== uid.value
    msg.value = await api.message(folderPath.value, uid.value)
    if (wasUnread) void mail.loadFolders()
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
watch([folderPath, uid], load, { immediate: true })

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
    if (isTypingTarget(e) || compose.isOpen || !msg.value) return
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

const fullDate = computed(() => (msg.value ? new Date(msg.value.date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) : ''))

async function act(action: () => Promise<unknown>, done: string) {
  try {
    await action()
    toast(done)
    void mail.loadFolders()
    await navigateTo(backLink.value)
  }
  catch (err) {
    toast.error(errorText(err))
  }
}

const doArchive = () => archive.value && act(() => api.move(folderPath.value, [uid.value], archive.value!.path), 'Message archivé')
const doDelete = () => act(() => api.remove(folderPath.value, [uid.value]), folder.value?.specialUse === 'trash' ? 'Message supprimé définitivement' : 'Message placé dans la corbeille')
const doMove = (path: string, name: string) => act(() => api.move(folderPath.value, [uid.value], path), `Message déplacé vers « ${name} »`)
const doUnread = () => act(() => api.setFlags(folderPath.value, [uid.value], { seen: false }), 'Marqué comme non lu')

async function toggleStar() {
  if (!msg.value) return
  const next = !msg.value.flagged
  msg.value.flagged = next
  try {
    await api.setFlags(folderPath.value, [uid.value], { flagged: next })
  }
  catch (err) {
    msg.value.flagged = !next
    toast.error(errorText(err))
  }
}

const me = computed(() => user.value?.email ?? '')
const canReplyAll = computed(() => !!msg.value && (msg.value.to.length + msg.value.cc.length) > 1)

useHead({ title: computed(() => msg.value?.subject ?? 'Message') })
</script>

<template>
  <article class="flex min-h-0 flex-1 flex-col" aria-labelledby="sujet">
    <div class="sticky top-16 z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border/60 bg-surface-panel px-2 lg:static lg:h-12 lg:px-3" role="toolbar" aria-label="Actions sur le message">
      <Tooltip>
        <TooltipTrigger as-child>
          <NuxtLink :to="backLink" class="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground lg:size-10" aria-label="Retour à la liste">
            <ArrowLeft class="size-5" aria-hidden="true" />
          </NuxtLink>
        </TooltipTrigger>
        <TooltipContent>Retour à la liste</TooltipContent>
      </Tooltip>
      <template v-if="msg">
        <MailIconButton v-if="archive && folderPath !== archive.path" :icon="Archive" label="Archiver" @click="doArchive" />
        <MailIconButton :icon="Trash2" :label="folder?.specialUse === 'trash' ? 'Supprimer définitivement' : 'Supprimer'" @click="doDelete" />
        <MailIconButton :icon="Mail" label="Marquer comme non lu" @click="doUnread" />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <button type="button" class="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground lg:size-10" aria-label="Déplacer vers">
                  <FolderInput class="size-5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Déplacer vers</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
            <DropdownMenuItem v-for="f in moveTargets" :key="f.path" @select="doMove(f.path, f.name)">{{ f.name }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="flex flex-col gap-4 p-4 lg:p-6" aria-busy="true" aria-label="Chargement du message">
        <Skeleton class="h-7 w-2/3" />
        <div class="flex items-center gap-3">
          <Skeleton class="size-10 rounded-full" />
          <div class="flex flex-1 flex-col gap-2"><Skeleton class="h-4 w-48" /><Skeleton class="h-3 w-32" /></div>
        </div>
        <Skeleton class="h-64 w-full rounded-xl" />
      </div>

      <div v-else-if="notFound || failed" class="flex flex-col items-center gap-3 px-6 py-16 text-center" role="alert">
        <CircleAlert class="size-10 text-destructive" aria-hidden="true" />
        <p class="font-medium">{{ notFound ? 'Ce message n’existe plus. Il a peut-être été déplacé ou supprimé.' : 'Impossible d’afficher ce message.' }}</p>
        <div class="flex gap-2">
          <Button v-if="failed" variant="outline" class="h-11 rounded-full px-6" @click="load">Réessayer</Button>
          <Button as-child variant="outline" class="h-11 rounded-full px-6"><NuxtLink :to="backLink">Retour à la liste</NuxtLink></Button>
        </div>
      </div>

      <div v-else-if="msg" class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
        <div class="flex items-start gap-3">
          <h1 id="sujet" class="min-w-0 flex-1 text-xl leading-snug font-normal break-words lg:text-[22px]">{{ msg.subject }}</h1>
          <span v-if="folder" class="mt-1 hidden shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:inline">{{ folder.name }}</span>
        </div>

        <div class="flex items-start gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" :class="getAvatarColorClass(msg.from?.address ?? '')" aria-hidden="true">
            {{ getInitials(msg.from?.name || msg.from?.address.split('@')[0] || '?') }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="font-semibold">{{ msg.from?.name || msg.from?.address || '(expéditeur inconnu)' }}</span>
              <span v-if="msg.from?.name" class="truncate text-xs text-muted-foreground">&lt;{{ msg.from.address }}&gt;</span>
            </div>
            <button type="button" class="inline-flex max-w-full items-center gap-1 rounded text-left text-xs text-muted-foreground hover:text-foreground" :aria-expanded="showDetails" @click="showDetails = !showDetails">
              <span class="truncate">à {{ shortList([...msg.to, ...msg.cc]) || '(aucun destinataire)' }}</span>
              <ChevronDown class="size-3.5 shrink-0 transition-transform" :class="{ 'rotate-180': showDetails }" aria-hidden="true" />
              <span class="sr-only">{{ showDetails ? 'Masquer' : 'Afficher' }} les détails</span>
            </button>
            <dl v-if="showDetails" class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border p-3 text-xs">
              <dt class="text-muted-foreground">De</dt><dd class="break-all">{{ msg.from ? formatAddress(msg.from) : '—' }}</dd>
              <template v-if="msg.replyTo.length"><dt class="text-muted-foreground">Répondre à</dt><dd class="break-all">{{ msg.replyTo.map(formatAddress).join(', ') }}</dd></template>
              <dt class="text-muted-foreground">À</dt><dd class="break-all">{{ msg.to.map(formatAddress).join(', ') || '—' }}</dd>
              <template v-if="msg.cc.length"><dt class="text-muted-foreground">Cc</dt><dd class="break-all">{{ msg.cc.map(formatAddress).join(', ') }}</dd></template>
              <template v-if="msg.bcc.length"><dt class="text-muted-foreground">Cci</dt><dd class="break-all">{{ msg.bcc.map(formatAddress).join(', ') }}</dd></template>
              <dt class="text-muted-foreground">Date</dt><dd>{{ fullDate }}</dd>
            </dl>
          </div>
          <time class="hidden shrink-0 text-xs text-muted-foreground sm:block" :datetime="msg.date">{{ fullDate }}</time>
          <MailIconButton :icon="Star" :label="msg.flagged ? 'Retirer l’étoile' : 'Ajouter une étoile'" :pressed="msg.flagged" :class="msg.flagged ? '[&_svg]:fill-amber-400 [&_svg]:text-amber-500' : ''" @click="toggleStar" />
        </div>

        <p v-if="thread.length" class="-mb-2 text-xs font-medium text-muted-foreground">{{ thread.length + 1 }} messages dans cette conversation</p>
        <section v-if="earlier.length" aria-label="Messages précédents de la conversation">
          <ul class="flex flex-col gap-2">
            <MailThreadItem v-for="m in earlier" :key="`${m.folder}:${m.uid}`" :item="m" :folder-name="threadFolderName(m)" />
          </ul>
        </section>

        <div v-if="msg.remoteImages > 0 && !showRemote" class="flex flex-col gap-2 rounded-xl bg-secondary px-4 py-3 text-sm sm:flex-row sm:items-center" role="status">
          <ImageOff class="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
          <p class="flex-1">Les images distantes sont masquées pour protéger votre vie privée.</p>
          <Button variant="outline" class="h-10 self-start rounded-full px-4 sm:self-auto" @click="showRemote = true">Afficher les images</Button>
        </div>

        <MailFrame :html="msg.html" :text="msg.text" :show-remote="showRemote" />

        <section v-if="msg.attachments.length" aria-labelledby="pj-titre" class="flex flex-col gap-2">
          <h2 id="pj-titre" class="flex items-center gap-2 text-sm font-medium">
            <Paperclip class="size-4" aria-hidden="true" />
            {{ msg.attachments.length }} pièce{{ msg.attachments.length > 1 ? 's' : '' }} jointe{{ msg.attachments.length > 1 ? 's' : '' }}
          </h2>
          <ul class="flex flex-wrap gap-2">
            <li v-for="a in msg.attachments" :key="a.id">
              <a
                :href="api.attachmentUrl(folderPath, uid, a.id)"
                :download="a.filename"
                class="flex h-14 max-w-72 items-center gap-3 rounded-xl border px-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <FileText class="size-6 shrink-0 text-destructive" aria-hidden="true" />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-sm font-medium">{{ a.filename }}</span>
                  <span class="text-xs text-muted-foreground">{{ formatSize(a.size) }}</span>
                </span>
                <Download class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="sr-only">Télécharger</span>
              </a>
            </li>
          </ul>
        </section>

        <section v-if="later.length" aria-label="Réponses suivantes de la conversation">
          <ul class="flex flex-col gap-2">
            <MailThreadItem v-for="m in later" :key="`${m.folder}:${m.uid}`" :item="m" :folder-name="threadFolderName(m)" />
          </ul>
        </section>

        <div class="flex flex-wrap gap-2 pt-2 pb-24 lg:pb-4">
          <Button variant="outline" class="h-11 rounded-full px-5" @click="compose.openReply(msg, me, 'reply')">
            <Reply class="size-4" aria-hidden="true" /> Répondre
          </Button>
          <Button v-if="canReplyAll" variant="outline" class="h-11 rounded-full px-5" @click="compose.openReply(msg, me, 'replyAll')">
            <ReplyAll class="size-4" aria-hidden="true" /> Répondre à tous
          </Button>
          <Button variant="outline" class="h-11 rounded-full px-5" @click="compose.openForward(msg)">
            <Forward class="size-4" aria-hidden="true" /> Transférer
          </Button>
        </div>
      </div>
    </div>
  </article>
</template>
