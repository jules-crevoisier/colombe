<script setup lang="ts">
import { ChevronLeft } from '@lucide/vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

definePageMeta({ layout: 'mail' })

const route = useRoute()
const prefs = usePrefsStore()

const selectedTab = computed({
  get: () => {
    const tab = route.query.tab
    return typeof tab === 'string' ? tab : 'general'
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
  title: 'Paramètres - Webmail MMI',
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
      <div class="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <!-- Onglets en pilules, même langage visuel que les dossiers de la barre latérale (bg-nav-active). -->
        <TabsRoot v-model="selectedTab" class="w-full">
          <TabsList aria-label="Sections des paramètres" class="mb-6 flex w-full gap-1 overflow-x-auto [scrollbar-width:none]">
            <TabsTrigger value="general" class="h-11 flex-none rounded-full px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:bg-nav-active data-[state=active]:font-semibold data-[state=active]:text-nav-active-foreground lg:h-10">Général</TabsTrigger>
            <TabsTrigger value="signature" class="h-11 flex-none rounded-full px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:bg-nav-active data-[state=active]:font-semibold data-[state=active]:text-nav-active-foreground lg:h-10">Signature</TabsTrigger>
            <TabsTrigger value="security" class="h-11 flex-none rounded-full px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:bg-nav-active data-[state=active]:font-semibold data-[state=active]:text-nav-active-foreground lg:h-10">Sécurité</TabsTrigger>
            <TabsTrigger value="contacts" class="h-11 flex-none rounded-full px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:bg-nav-active data-[state=active]:font-semibold data-[state=active]:text-nav-active-foreground lg:h-10">Contacts</TabsTrigger>
          </TabsList>

          <TabsContent value="general" class="outline-none">
            <SettingsGeneralSettings />
          </TabsContent>
          <TabsContent value="signature" class="outline-none">
            <SettingsSignatureSettings />
          </TabsContent>
          <TabsContent value="security" class="outline-none">
            <SettingsSecuritySettings />
          </TabsContent>
          <TabsContent value="contacts" class="outline-none">
            <SettingsContactsSettings />
          </TabsContent>
        </TabsRoot>
      </div>
    </div>
  </div>
</template>
