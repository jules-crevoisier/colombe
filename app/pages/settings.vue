<script setup lang="ts">
import { ChevronLeft } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { useI18n } from 'vue-i18n'

definePageMeta({ layout: 'mail' })

const route = useRoute()
const prefs = usePrefsStore()
const { t } = useI18n()

/** Anciens paramètres migrés vers un nouvel onglet (ex. la signature devient une identité). */
const TAB_ALIASES: Record<string, string> = { signature: 'identities' }

const SECTIONS = [
  { value: 'general' },
  { value: 'identities' },
  { value: 'responses' },
  { value: 'display' },
  { value: 'compose' },
  { value: 'folders' },
  { value: 'filters' },
  { value: 'vacation' },
  { value: 'forward' },
  { value: 'devices' },
  { value: 'server' },
  { value: 'security' },
  { value: 'contacts' },
] as const

const isDesktop = useMediaQuery('(min-width: 1024px)')

/** Titre de section (h2) : repère pour les lecteurs d'écran, identique à l'onglet. */
function sectionLabel(value: string): string {
  return t(`settings.tabs.${value}`)
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
  title: computed(() => t('settings.page.title')),
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- En-tête -->
    <div class="flex items-center gap-2 border-b border-border px-2 py-3 sm:px-4 lg:px-6 lg:py-4">
      <NuxtLink
        to="/mail/INBOX"
        class="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:size-10"
        :aria-label="t('settings.page.backToMail')"
      >
        <ChevronLeft class="size-5" aria-hidden="true" />
      </NuxtLink>
      <h1 class="font-heading text-[26px] leading-tight font-medium tracking-[-0.015em] lg:text-[30px]">{{ t('settings.page.heading') }}</h1>
    </div>

    <!-- Contenu -->
    <div class="flex-1 overflow-auto">
      <div class="mx-auto max-w-5xl px-4 pt-2 pb-10 sm:px-6 lg:px-8 lg:py-8">
        <!-- Onglets : même langage que les dossiers (signet d'encre), jamais de pilule.
             Liste verticale à gauche à partir de 1024 px ; rangée soulignée défilante en dessous. -->
        <TabsRoot v-model="selectedTab" :orientation="isDesktop ? 'vertical' : 'horizontal'" class="w-full lg:flex lg:items-start lg:gap-10">
          <TabsList :aria-label="t('settings.page.sectionsLabel')" class="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:mx-0 lg:mb-0 lg:w-52 lg:shrink-0 lg:flex-col lg:gap-px lg:overflow-visible lg:border-b-0 lg:px-0">
            <TabsTrigger
              v-for="section in SECTIONS"
              :key="section.value"
              :value="section.value"
              class="relative -mb-px h-11 flex-none border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=active]:border-nav-marker data-[state=active]:font-semibold data-[state=active]:text-foreground lg:mb-0 lg:h-9 lg:w-full lg:justify-start lg:rounded-md lg:border-b-0 lg:text-left lg:text-foreground/85 lg:hover:bg-foreground/[0.05] lg:data-[state=active]:bg-accent lg:data-[state=active]:before:absolute lg:data-[state=active]:before:top-1/2 lg:data-[state=active]:before:left-0 lg:data-[state=active]:before:h-4 lg:data-[state=active]:before:w-[3px] lg:data-[state=active]:before:-translate-y-1/2 lg:data-[state=active]:before:rounded-r-sm lg:data-[state=active]:before:bg-nav-marker"
            >
              {{ sectionLabel(section.value) }}
            </TabsTrigger>
          </TabsList>

          <div class="min-w-0 flex-1">
            <TabsContent value="general" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('general') }}</h2>
              <SettingsGeneralSettings />
            </TabsContent>
            <TabsContent value="identities" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('identities') }}</h2>
              <SettingsIdentitiesSettings />
            </TabsContent>
            <TabsContent value="responses" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('responses') }}</h2>
              <SettingsResponsesSettings />
            </TabsContent>
            <TabsContent value="display" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('display') }}</h2>
              <SettingsDisplaySettings />
            </TabsContent>
            <TabsContent value="compose" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('compose') }}</h2>
              <SettingsComposeSettings />
            </TabsContent>
            <TabsContent value="folders" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('folders') }}</h2>
              <SettingsFoldersSettings />
            </TabsContent>
            <TabsContent value="filters" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('filters') }}</h2>
              <SettingsFiltersSettings />
            </TabsContent>
            <TabsContent value="vacation" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('vacation') }}</h2>
              <SettingsVacationSettings />
            </TabsContent>
            <TabsContent value="forward" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('forward') }}</h2>
              <SettingsForwardSettings />
            </TabsContent>
            <TabsContent value="devices" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('devices') }}</h2>
              <SettingsDevicesSettings />
            </TabsContent>
            <TabsContent value="server" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('server') }}</h2>
              <SettingsServerSettings />
            </TabsContent>
            <TabsContent value="security" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('security') }}</h2>
              <SettingsSecuritySettings />
            </TabsContent>
            <TabsContent value="contacts" class="outline-none">
              <h2 class="mb-5 font-heading text-2xl font-medium tracking-[-0.01em]">{{ sectionLabel('contacts') }}</h2>
              <SettingsContactsSettings />
            </TabsContent>
          </div>
        </TabsRoot>
      </div>
    </div>
  </div>
</template>
