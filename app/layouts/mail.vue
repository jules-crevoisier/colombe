<script setup lang="ts">
import type { SearchField } from '#shared/types/mail'
import { onKeyStroke, useColorMode, useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { Keyboard, LogOut, Menu, Moon, PenLine, Search, Settings, Sun, X, Sliders } from '@lucide/vue'
import type { MessageQuery } from '#shared/types/mail'

const mail = useMailStore()
const compose = useComposeStore()
const api = useMailApi()
const route = useRoute()
const { user } = useUserSession()
const { config: siteConfig } = useSiteConfig()

const email = computed(() => user.value?.email ?? '')
const mode = useColorMode({ storageKey: 'wm-color-mode' })
const isDark = computed(() => mode.value === 'dark')

const drawerOpen = ref(false)
const railCollapsed = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const searchOptionsOpen = ref(false)

// Options de recherche avancée (docs/dev/PLAN-v3.md R1.2), synchronisées avec l'URL.
const SEARCH_FIELDS: readonly SearchField[] = ['subject', 'from', 'to', 'cc', 'body']
function isSearchField(v: string): v is SearchField {
  return (SEARCH_FIELDS as readonly string[]).includes(v)
}
const searchOptions = reactive({
  fields: (typeof route.query.fields === 'string' ? route.query.fields.split(',').filter(isSearchField) : []) as SearchField[],
  scope: (typeof route.query.scope === 'string' ? route.query.scope : 'folder') as 'folder' | 'all',
  unread: route.query.unread === '1',
  flagged: route.query.flagged === '1',
  unanswered: route.query.unanswered === '1',
  attachments: route.query.attachments === '1',
  since: (typeof route.query.since === 'string' ? route.query.since : '') as string,
  before: (typeof route.query.before === 'string' ? route.query.before : '') as string,
})

const currentFolder = computed(() => (typeof route.params.folder === 'string' ? route.params.folder : 'INBOX'))

watch(() => route.query.q, (q) => {
  search.value = typeof q === 'string' ? q : ''
})
watch(() => route.fullPath, () => {
  drawerOpen.value = false
})

function toggleMenu() {
  if (window.matchMedia('(min-width: 1024px)').matches) railCollapsed.value = !railCollapsed.value
  else drawerOpen.value = true
}

function submitSearch() {
  const q = search.value.trim()
  const query: Record<string, string | undefined> = {}
  if (q) query.q = q
  if (searchOptions.fields.length) query.fields = searchOptions.fields.join(',')
  if (searchOptions.scope === 'all') query.scope = 'all'
  if (searchOptions.unread) query.unread = '1'
  if (searchOptions.flagged) query.flagged = '1'
  if (searchOptions.unanswered) query.unanswered = '1'
  if (searchOptions.attachments) query.attachments = '1'
  if (searchOptions.since) query.since = searchOptions.since
  if (searchOptions.before) query.before = searchOptions.before
  searchOptionsOpen.value = false
  void navigateTo({ path: `/mail/${encodeURIComponent(currentFolder.value)}`, query })
  searchInput.value?.blur()
}

function clearSearch() {
  search.value = ''
  searchOptions.fields = []
  searchOptions.scope = 'folder'
  searchOptions.unread = false
  searchOptions.flagged = false
  searchOptions.unanswered = false
  searchOptions.attachments = false
  searchOptions.since = ''
  searchOptions.before = ''
  searchOptionsOpen.value = false
  void navigateTo({ path: `/mail/${encodeURIComponent(currentFolder.value)}` })
}

function resetSearchOptions() {
  clearSearch()
}

/** « Créer un filtre » (docs/dev/PLAN-v4.md F.2) : prérempli depuis les critères de recherche saisis. */
function createFilterFromSearch() {
  const filters = useFiltersStore()
  const q = search.value.trim()
  const fields = searchOptions.fields
  const prefill: { from?: string; to?: string; subject?: string; containsWords?: string } = {}
  if (q) {
    if (fields.includes('from')) prefill.from = q
    if (fields.includes('to')) prefill.to = q
    if (fields.includes('subject')) prefill.subject = q
    if (fields.includes('body') || fields.length === 0) prefill.containsWords = q
  }
  searchOptionsOpen.value = false
  filters.openCreate(prefill)
}

// Raccourcis globaux : « c » nouveau message, « / » recherche, « ? » aide (ignorés pendant la saisie).
const isTyping = isTypingTarget
const shortcutsOpen = ref(false)
onKeyStroke('?', (e) => {
  if (isTyping(e)) return
  e.preventDefault()
  shortcutsOpen.value = true
})
onKeyStroke('c', (e) => {
  if (isTyping(e) || compose.opening) return
  e.preventDefault()
  void compose.openNew()
})
onKeyStroke('/', (e) => {
  if (isTyping(e)) return
  e.preventDefault()
  searchInput.value?.focus()
})

// Compteurs rafraîchis toutes les 60 s quand l'onglet est visible.
const visibility = useDocumentVisibility()
useIntervalFn(() => {
  if (visibility.value === 'visible') void mail.loadFolders()
}, 60_000)
const prefs = usePrefsStore()
onMounted(() => {
  if (!mail.loaded) void mail.loadFolders()
  if (!prefs.loaded) void prefs.load()
})
useLiveUpdates()

useHead({
  title: computed(() => (mail.inboxUnread ? `(${mail.inboxUnread}) ${siteConfig.value.productName}` : siteConfig.value.productName)),
})
</script>

<template>
  <div class="flex min-h-[100dvh] bg-surface-app lg:h-[100dvh]">
    <a href="#contenu" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2.5 focus:text-primary-foreground">
      Aller au contenu
    </a>

    <!-- Bureau (≥ 1024 px) : colonne pleine hauteur, la marque en tête, puis les dossiers. -->
    <aside
      class="hidden shrink-0 flex-col pb-3 transition-[width] duration-200 ease-out lg:flex"
      :class="railCollapsed ? 'w-[76px] items-center px-2' : 'w-[248px] px-3'"
    >
      <NuxtLink
        to="/mail/INBOX"
        class="mb-2 flex h-16 shrink-0 items-center gap-2.5 rounded-lg px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        :class="railCollapsed ? 'justify-center' : ''"
        :aria-label="railCollapsed ? 'Colombe' : undefined"
      >
        <BrandLogo class="size-8 shrink-0" />
        <span v-if="!railCollapsed" class="font-heading text-[23px] leading-none font-semibold tracking-[-0.01em]">Colombe</span>
      </NuxtLink>
      <MailFolderNav :collapsed="railCollapsed" />
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-1 bg-surface-app px-2 sm:gap-2 lg:static lg:pr-3 lg:pl-0">
        <MailIconButton :icon="Menu" label="Menu principal" @click="toggleMenu" />
        <NuxtLink to="/mail/INBOX" class="hidden items-center gap-2 rounded-lg pr-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex lg:hidden">
          <BrandLogo class="size-8" />
          <span class="font-heading text-[22px] leading-none font-semibold tracking-[-0.01em]">Colombe</span>
        </NuxtLink>

        <form role="search" class="min-w-0 flex-1 lg:max-w-2xl" @submit.prevent="submitSearch">
          <div class="group relative flex h-11 items-center rounded-lg border border-border bg-search transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_18%,transparent)] lg:h-10">
            <button type="submit" class="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring lg:size-10" aria-label="Lancer la recherche">
              <Search class="size-[18px]" aria-hidden="true" />
            </button>
            <label for="search" class="sr-only">Rechercher dans les messages</label>
            <input
              id="search"
              ref="searchInput"
              v-model="search"
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              placeholder="Rechercher dans les messages"
              class="peer h-full min-w-0 flex-1 bg-transparent pr-2 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              @keydown.esc="clearSearch"
            >
            <kbd v-if="!search" class="mr-1 hidden h-6 min-w-6 place-items-center rounded border border-border px-1.5 font-sans text-xs text-muted-foreground peer-focus:hidden lg:grid" aria-hidden="true">/</kbd>
            <!-- Options de recherche -->
            <Popover v-model:open="searchOptionsOpen">
              <PopoverTrigger as-child>
                <button type="button" class="mr-0.5 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-accent lg:size-9" aria-label="Options de recherche">
                  <Sliders class="size-4" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <!-- Contrôles natifs (cases, boutons radio, dates) : accessibles et sans dépendance. -->
              <PopoverContent align="end" :collision-padding="8" class="max-h-[var(--reka-popover-content-available-height)] w-[min(calc(100vw-2rem),24rem)] overflow-y-auto overscroll-contain p-4">
                <form class="flex flex-col gap-4" aria-label="Options de recherche" @submit.prevent="submitSearch">
                  <fieldset class="flex flex-col gap-0.5">
                    <legend class="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Chercher dans</legend>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.fields" type="checkbox" value="subject" class="size-[18px] shrink-0"> Objet</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.fields" type="checkbox" value="from" class="size-[18px] shrink-0"> Expéditeur</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.fields" type="checkbox" value="to" class="size-[18px] shrink-0"> Destinataires</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.fields" type="checkbox" value="body" class="size-[18px] shrink-0"> Corps du message</label>
                  </fieldset>
                  <fieldset class="flex flex-col gap-0.5">
                    <legend class="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Portée</legend>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.scope" type="radio" name="search-scope" value="folder" class="size-[18px] shrink-0"> Ce dossier</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.scope" type="radio" name="search-scope" value="all" class="size-[18px] shrink-0"> Tous les dossiers</label>
                  </fieldset>
                  <fieldset class="flex flex-col gap-0.5">
                    <legend class="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Filtres</legend>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.unread" type="checkbox" class="size-[18px] shrink-0"> Non lus</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.flagged" type="checkbox" class="size-[18px] shrink-0"> Suivis</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.unanswered" type="checkbox" class="size-[18px] shrink-0"> Sans réponse</label>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent lg:min-h-9"><input v-model="searchOptions.attachments" type="checkbox" class="size-[18px] shrink-0"> Avec pièce jointe</label>
                  </fieldset>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1.5">
                      <Label for="search-since">Du</Label>
                      <Input id="search-since" v-model="searchOptions.since" type="date" class="h-11 text-base" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <Label for="search-before">Au</Label>
                      <Input id="search-before" v-model="searchOptions.before" type="date" class="h-11 text-base" />
                    </div>
                  </div>
                  <div class="flex gap-2 border-t border-border pt-4">
                    <Button type="button" variant="outline" class="h-11 flex-1" @click="resetSearchOptions">Réinitialiser</Button>
                    <Button type="submit" class="h-11 flex-1">Rechercher</Button>
                  </div>
                  <Button type="button" variant="ghost" class="h-11 w-full" @click="createFilterFromSearch">Créer un filtre</Button>
                </form>
              </PopoverContent>
            </Popover>

            <button v-if="search" type="button" class="mr-0.5 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:size-9" aria-label="Effacer la recherche" @click="clearSearch">
              <X class="size-[18px]" aria-hidden="true" />
            </button>
          </div>
        </form>

        <div class="flex shrink-0 items-center gap-1 lg:ml-auto">
          <MailIconButton class="hidden sm:inline-flex" :icon="isDark ? Sun : Moon" :label="isDark ? 'Passer en mode clair' : 'Passer en mode sombre'" @click="mode = isDark ? 'light' : 'dark'" />

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button type="button" class="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-accent" :aria-label="`Compte ${email}`">
                <span class="grid size-8 place-items-center rounded-full text-[13px] font-semibold text-white" :class="getAvatarTone(email)">
                  {{ getInitials(email.split('@')[0]?.replace(/[._-]+/g, ' ') ?? '') }}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-64">
              <DropdownMenuLabel class="font-normal">
                <span class="block text-xs text-muted-foreground">Connecté en tant que</span>
                <span class="block truncate font-medium">{{ email }}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="sm:hidden" @select="mode = isDark ? 'light' : 'dark'">
                <component :is="isDark ? Sun : Moon" class="size-4" aria-hidden="true" />
                {{ isDark ? 'Mode clair' : 'Mode sombre' }}
              </DropdownMenuItem>
              <DropdownMenuItem @select="navigateTo('/settings')">
                <Settings class="size-4" aria-hidden="true" />
                Paramètres
              </DropdownMenuItem>
              <DropdownMenuItem @select="shortcutsOpen = true">
                <Keyboard class="size-4" aria-hidden="true" />
                Raccourcis clavier
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="api.logout()">
                <LogOut class="size-4" aria-hidden="true" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <!-- La feuille : posée sur le bureau à partir de 1024 px. -->
      <main id="contenu" class="flex min-w-0 flex-1 flex-col bg-surface-panel lg:mr-3 lg:mb-3 lg:overflow-hidden lg:rounded-xl lg:border lg:border-border lg:shadow-sheet">
        <slot />
      </main>
    </div>

    <Sheet v-model:open="drawerOpen">
      <SheetContent side="left" class="w-[86vw] max-w-80 gap-2 border-border bg-surface-app p-3">
        <SheetHeader class="flex-row items-center gap-2.5 p-1 pb-2">
          <BrandLogo class="size-8 shrink-0" />
          <SheetTitle class="font-heading text-[22px] leading-none font-semibold tracking-[-0.01em]">Colombe</SheetTitle>
          <SheetDescription class="sr-only">Navigation entre les dossiers</SheetDescription>
        </SheetHeader>
        <MailFolderNav @navigate="drawerOpen = false" />
      </SheetContent>
    </Sheet>

    <!-- Mobile : « Nouveau message », une lettre au coin replié. L'ombre est portée par
         l'enveloppe : le coin découpé du bouton rognerait une ombre posée sur le bouton.
         Absent des Paramètres et des Contacts : une seule action principale par écran
         (« Nouveau contact », « Écrire un message »), et il masquait « Enregistrer » d'une fiche. -->
    <div
      v-if="!compose.isOpen && !route.path.startsWith('/settings') && !route.path.startsWith('/contacts')"
      class="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 drop-shadow-[0_10px_16px_rgb(13_19_36/0.28)] lg:hidden"
    >
      <button
        type="button"
        class="fold-corner flex h-14 items-center gap-2.5 rounded-lg bg-compose pr-6 pl-5 text-[15px] font-semibold text-compose-foreground active:translate-y-px"
        @click="compose.openNew()"
      >
        <PenLine class="size-5" aria-hidden="true" />
        Nouveau message
      </button>
    </div>

    <MailComposeWindow />
    <MailShortcutsDialog v-model:open="shortcutsOpen" />
  </div>
</template>
