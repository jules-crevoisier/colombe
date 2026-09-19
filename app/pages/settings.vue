<script setup lang="ts">
import { ChevronLeft } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

definePageMeta({ layout: 'mail' })

const route = useRoute()
const prefs = usePrefsStore()

/** Anciens paramètres migrés vers un nouvel onglet (ex. la signature devient une identité). */
const TAB_ALIASES: Record<string, string> = { signature: 'identities' }

const SECTIONS = [
  { value: 'general', label: 'Général' },
  { value: 'identities', label: 'Identités' },
  { value: 'responses', label: 'Réponses types' },
  { value: 'display', label: 'Affichage' },
  { value: 'compose', label: 'Rédaction' },
  { value: 'folders', label: 'Dossiers' },
  { value: 'filters', label: 'Filtres' },
  { value: 'vacation', label: 'Réponse automatique' },
  { value: 'forward', label: 'Transfert' },
  { value: 'server', label: 'Serveur' },
  { value: 'security', label: 'Sécurité' },
  { value: 'contacts', label: 'Contacts' },
] as const

const isDesktop = useMediaQuery('(min-width: 1024px)')

/** Titre de section (h2) : repère pour les lecteurs d'écran, identique à l'onglet. */
function sectionLabel(value: string): string {
  return SECTIONS.find(s => s.value === value)?.label ?? ''
}

const selectedTab = computed({
  get: () => {
    const tab = route.query.tab
    const value = typeof tab === 'string' ? tab : 'general'
    return TAB_ALIASES[value] ?? value
  },
  set: (value: string) => {
    void navigateTo({ query: { tab: value } })
  },
})

onMounted(async () => {
  if (!prefs.loaded) {
    await prefs.load()
  }
})

useHead({
  title: 'Paramètres - Colombe',
})
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Header -->
    <div class="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5">
      <NuxtLink
        to="/mail/INBOX"
        class="inline-flex items-center justify-center rounded-full hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Retour à la messagerie"
      >
        <ChevronLeft class="size-5" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-2xl font-normal">Paramètres</h1>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto">
      <div class="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <!-- Onglets en pilules, même langage visuel que les dossiers de la barre latérale (bg-nav-active).
             Liste verticale à gauche à partir de 1024 px ; rangée horizontale défilante en dessous. -->
        <TabsRoot v-model="selectedTab" :orientation="isDesktop ? 'vertical' : 'horizontal'" class="w-full lg:flex lg:items-start lg:gap-8">
          <TabsList aria-label="Sections des paramètres" class="mb-6 flex w-full gap-1 overflow-x-auto [scrollbar-width:none] lg:mb-0 lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible">
            <TabsTrigger
              v-for="section in SECTIONS"
              :key="section.value"
              :value="section.value"
              class="h-11 flex-none rounded-full px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:bg-nav-active data-[state=active]:font-semibold data-[state=active]:text-nav-active-foreground lg:h-10 lg:w-full lg:justify-start lg:text-left"
            >
              {{ section.label }}
            </TabsTrigger>
          </TabsList>

          <div class="min-w-0 flex-1">
            <TabsContent value="general" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('general') }}</h2>
              <SettingsGeneralSettings />
            </TabsContent>
            <TabsContent value="identities" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('identities') }}</h2>
              <SettingsIdentitiesSettings />
            </TabsContent>
            <TabsContent value="responses" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('responses') }}</h2>
              <SettingsResponsesSettings />
            </TabsContent>
            <TabsContent value="display" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('display') }}</h2>
              <SettingsDisplaySettings />
            </TabsContent>
            <TabsContent value="compose" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('compose') }}</h2>
              <SettingsComposeSettings />
            </TabsContent>
            <TabsContent value="folders" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('folders') }}</h2>
              <SettingsFoldersSettings />
            </TabsContent>
            <TabsContent value="filters" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('filters') }}</h2>
              <SettingsFiltersSettings />
            </TabsContent>
            <TabsContent value="vacation" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('vacation') }}</h2>
              <SettingsVacationSettings />
            </TabsContent>
            <TabsContent value="forward" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('forward') }}</h2>
              <SettingsForwardSettings />
            </TabsContent>
            <TabsContent value="server" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('server') }}</h2>
              <SettingsServerSettings />
            </TabsContent>
            <TabsContent value="security" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('security') }}</h2>
              <SettingsSecuritySettings />
            </TabsContent>
            <TabsContent value="contacts" class="outline-none">
              <h2 class="mb-4 text-lg font-medium">{{ sectionLabel('contacts') }}</h2>
              <SettingsContactsSettings />
            </TabsContent>
          </div>
        </TabsRoot>
      </div>
    </div>
  </div>
</template>
