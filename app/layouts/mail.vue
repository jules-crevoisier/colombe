<script setup lang="ts">
import { onKeyStroke, useColorMode, useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { Keyboard, LogOut, Menu, Moon, Pencil, Search, Settings, Sun, X } from '@lucide/vue'

const mail = useMailStore()
const compose = useComposeStore()
const api = useMailApi()
const route = useRoute()
const { user } = useUserSession()

const email = computed(() => user.value?.email ?? '')
const mode = useColorMode({ storageKey: 'wm-color-mode' })
const isDark = computed(() => mode.value === 'dark')

const drawerOpen = ref(false)
const railCollapsed = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')

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
  void navigateTo({ path: `/mail/${encodeURIComponent(currentFolder.value)}`, query: q ? { q } : {} })
  searchInput.value?.blur()
}

function clearSearch() {
  search.value = ''
  void navigateTo({ path: `/mail/${encodeURIComponent(currentFolder.value)}` })
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
  if (isTyping(e)) return
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
  title: computed(() => (mail.inboxUnread ? `(${mail.inboxUnread}) Webmail MMI` : 'Webmail MMI')),
})
</script>

<template>
  <div class="flex min-h-[100dvh] flex-col bg-surface-app lg:h-[100dvh]">
    <a href="#contenu" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
      Aller au contenu
    </a>

    <header class="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-1 bg-surface-app px-2 lg:static lg:gap-2 lg:px-4">
      <MailIconButton :icon="Menu" label="Menu principal" @click="toggleMenu" />
      <NuxtLink to="/mail/INBOX" class="hidden items-center gap-2 pr-6 text-lg font-medium tracking-tight md:flex lg:w-[200px]">
        <span class="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">M</span>
        Webmail
      </NuxtLink>

      <form role="search" class="min-w-0 flex-1 lg:max-w-3xl" @submit.prevent="submitSearch">
        <div class="group relative flex h-12 items-center rounded-full bg-search transition-colors focus-within:bg-surface-panel focus-within:shadow-md">
          <button type="submit" class="grid size-12 shrink-0 place-items-center rounded-full text-muted-foreground" aria-label="Lancer la recherche">
            <Search class="size-5" aria-hidden="true" />
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
            class="h-full min-w-0 flex-1 bg-transparent pr-2 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            @keydown.esc="clearSearch"
          >
          <button v-if="search" type="button" class="mr-1 grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Effacer la recherche" @click="clearSearch">
            <X class="size-5" aria-hidden="true" />
          </button>
        </div>
      </form>

      <MailIconButton class="hidden sm:inline-flex" :icon="isDark ? Sun : Moon" :label="isDark ? 'Passer en mode clair' : 'Passer en mode sombre'" @click="mode = isDark ? 'light' : 'dark'" />

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button type="button" class="grid size-11 shrink-0 place-items-center rounded-full hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" :aria-label="`Compte ${email}`">
            <span class="grid size-8 place-items-center rounded-full text-sm font-semibold text-white" :class="getAvatarColorClass(email)">
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
    </header>

    <div class="flex min-h-0 flex-1">
      <aside
        class="hidden shrink-0 flex-col py-2 transition-[width] duration-200 lg:flex"
        :class="railCollapsed ? 'w-[88px] items-center px-2' : 'w-64 pr-3 pl-3'"
      >
        <MailFolderNav :collapsed="railCollapsed" />
      </aside>

      <main id="contenu" class="flex min-w-0 flex-1 flex-col bg-surface-panel lg:mr-4 lg:mb-4 lg:overflow-hidden lg:rounded-2xl">
        <slot />
      </main>
    </div>

    <Sheet v-model:open="drawerOpen">
      <SheetContent side="left" class="w-[85vw] max-w-80 bg-surface-app p-3 pt-4">
        <SheetHeader class="p-1 pb-2">
          <SheetTitle class="text-left text-lg font-medium">Webmail MMI</SheetTitle>
          <SheetDescription class="sr-only">Navigation entre les dossiers</SheetDescription>
        </SheetHeader>
        <MailFolderNav @navigate="drawerOpen = false" />
      </SheetContent>
    </Sheet>

    <button
      v-if="!compose.isOpen && !route.path.startsWith('/settings')"
      type="button"
      class="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex h-14 items-center gap-3 rounded-2xl bg-compose px-5 font-medium text-compose-foreground shadow-lg lg:hidden"
      @click="compose.openNew()"
    >
      <Pencil class="size-5" aria-hidden="true" />
      Nouveau message
    </button>

    <MailComposeWindow />
    <MailShortcutsDialog v-model:open="shortcutsOpen" />
  </div>
</template>
