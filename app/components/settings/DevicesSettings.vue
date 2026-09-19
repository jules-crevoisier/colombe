<script setup lang="ts">
import { ChevronRight, Download, Info, RotateCw, Unplug } from '@lucide/vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { renderSVG } from 'uqr'
import type { DeviceSettings } from '#shared/types/config'
import type { DeviceApp } from '~/utils/devices'

const api = useDevicesApi()

const loading = ref(true)
const failed = ref(false)
const settings = ref<DeviceSettings | null>(null)
const twoFactorEnabled = ref(false)
const app = ref<DeviceApp>('gmail')
const qrSvg = ref('')

const ready = computed(() => (settings.value && hasPublicServers(settings.value) ? settings.value : null))
const gmailForward = computed(() => canForwardToGmail(settings.value?.forwardDomains ?? []))
const forwardDomainLabels = computed(() => formatDomains(settings.value?.forwardDomains ?? []))
const apps = DEVICE_APPS
const profileUrl = api.appleProfileUrl()

/** Étapes de chaque guide, remplies avec les valeurs de l'utilisateur. */
const guides = computed(() => {
  const s = ready.value
  if (!s) return null
  return {
    gmailApp: gmailAppSteps(s),
    gmailSendAs: gmailSendAsSteps(s),
    appleProfile: appleProfileSteps(s),
    appleManual: appleManualSteps(s),
    outlook: outlookSteps(s),
    thunderbird: thunderbirdSteps(s),
    other: otherAppSteps(),
    settings: s,
  }
})

async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    const [deviceSettings, twoFactor] = await Promise.all([
      api.settings(),
      // Information secondaire : son échec ne bloque pas la page.
      api.twoFactor().catch(() => null),
    ])
    settings.value = deviceSettings
    twoFactorEnabled.value = twoFactor?.enabled === true
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  app.value = defaultDeviceApp(window.navigator.userAgent, window.navigator.maxTouchPoints)
  // QR code généré localement (aucun service externe), affiché en <img> : aucun script possible.
  qrSvg.value = renderSVG(`${window.location.origin}${apiUrl('/settings?tab=devices')}`, { border: 2 })
  void load()
})
</script>

<template>
  <div class="space-y-10">
    <p class="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
      Lisez et envoyez vos messages depuis une autre application : Gmail, Mail sur iPhone, Outlook, Thunderbird…
      Vos messages restent sur le serveur de votre établissement ; l'application s'y connecte avec votre adresse et votre mot de passe.
    </p>

    <!-- Chargement -->
    <div v-if="loading" class="space-y-4" aria-busy="true" aria-label="Chargement des paramètres">
      <Skeleton class="h-7 w-64" />
      <div class="grid gap-4 md:grid-cols-2">
        <Skeleton class="h-72 w-full" />
        <Skeleton class="h-72 w-full" />
      </div>
    </div>

    <!-- Erreur -->
    <div v-else-if="failed || !settings" role="alert" class="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface-panel p-4">
      <p class="text-[15px]">Impossible de charger vos paramètres de connexion.</p>
      <Button variant="outline" class="h-11 rounded-lg px-4" @click="load">
        <RotateCw class="size-4" aria-hidden="true" />
        Réessayer
      </Button>
    </div>

    <!-- Serveurs non publiés par l'administrateur -->
    <div v-else-if="!ready" class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
      <Unplug class="size-6 text-muted-foreground" aria-hidden="true" />
      <p class="max-w-md text-[15px] font-medium">Votre administrateur n'a pas encore publié les paramètres pour les autres applications.</p>
      <p class="max-w-md text-sm text-muted-foreground">En attendant, votre messagerie reste disponible ici, dans {{ settings.productName }}.</p>
    </div>

    <template v-else-if="guides">
      <!-- Ouvrir sur le téléphone (inutile quand on y est déjà : masqué sous 768 px) -->
      <section v-if="qrSvg" class="hidden items-center gap-5 rounded-lg border border-border bg-surface-panel p-4 md:flex" aria-labelledby="devices-qr-title">
        <img :src="`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`" alt="QR code vers cette page" class="size-28 shrink-0 rounded-md bg-white p-1.5">
        <div class="space-y-1">
          <h3 id="devices-qr-title" class="text-[15px] font-semibold">Ouvrir cette page sur votre téléphone</h3>
          <p class="max-w-prose text-sm text-muted-foreground">
            Scannez ce code avec l'appareil photo de votre téléphone pour y retrouver ces instructions (connectez-vous si besoin).
          </p>
        </div>
      </section>

      <!-- 1. Paramètres -->
      <section class="space-y-4" aria-labelledby="devices-settings-title">
        <div class="space-y-1">
          <h3 id="devices-settings-title" class="font-heading text-xl font-medium">Vos paramètres de connexion</h3>
          <p class="text-sm text-muted-foreground">À recopier dans l'application de votre choix, si elle ne les trouve pas toute seule.</p>
        </div>
        <SettingsDevicesServerTable :settings="guides.settings" />
        <p v-if="twoFactorEnabled" class="flex gap-2.5 rounded-lg bg-muted px-4 py-3 text-sm leading-relaxed">
          <Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            La double authentification protège la connexion à {{ guides.settings.productName }}.
            Les autres applications se connectent avec votre mot de passe habituel, sans code.
          </span>
        </p>
      </section>

      <!-- 2. Guides par application -->
      <section class="space-y-5 border-t border-border pt-8" aria-labelledby="devices-apps-title">
        <h3 id="devices-apps-title" class="font-heading text-xl font-medium">Choisissez votre application</h3>

        <TabsRoot v-model="app" class="space-y-6">
          <TabsList aria-labelledby="devices-apps-title" class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-wrap">
            <TabsTrigger
              v-for="(a, i) in apps"
              :key="a.value"
              :value="a.value"
              :class="[
                'flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface-panel px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:border-primary data-[state=active]:bg-accent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_0_0_1px_var(--primary)]',
                i === apps.length - 1 ? 'col-span-2 sm:col-span-1' : '',
              ]"
            >
              {{ a.label }}
            </TabsTrigger>
          </TabsList>

          <!-- Gmail -->
          <TabsContent value="gmail" class="space-y-8 outline-none">
            <div class="space-y-4">
              <h4 class="text-base font-semibold">Dans l'application Gmail (Android ou iPhone)</h4>
              <SettingsDevicesSteps :steps="guides.gmailApp" />
            </div>

            <aside class="space-y-3 rounded-lg border border-border bg-muted/60 p-4 sm:p-5" aria-labelledby="devices-gmail-web-title">
              <h4 id="devices-gmail-web-title" class="text-base font-semibold">Et Gmail sur ordinateur ?</h4>
              <p class="text-[15px] leading-relaxed">
                Depuis 2026, Gmail sur ordinateur ne peut plus relever le courrier d'autres comptes : Google a retiré la fonction qui le permettait. Deux solutions :
              </p>
              <ol class="list-[lower-alpha] space-y-3 pl-5 text-[15px] leading-relaxed marker:font-semibold">
                <li><span class="font-medium">L'application Gmail</span> sur votre téléphone, comme expliqué ci-dessus.</li>
                <li>
                  <span class="font-medium">Le transfert automatique</span> de vos messages vers votre adresse Gmail.
                  <template v-if="gmailForward">
                    Votre établissement l'autorise.
                    <span class="mt-3 block">
                      <Button as-child variant="outline" class="h-11 rounded-lg px-4">
                        <NuxtLink :to="{ path: '/settings', query: { tab: 'forward' } }">
                          Configurer le transfert
                          <ChevronRight class="size-4" aria-hidden="true" />
                        </NuxtLink>
                      </Button>
                    </span>
                  </template>
                  <template v-else>
                    Votre établissement ne l'autorise pas vers Gmail, pour éviter que des messages ne soient détournés si un mot de passe est volé.
                    <span v-if="guides.settings.forwardDomains.length" class="mt-1 block text-sm text-muted-foreground">Transfert possible uniquement vers :
                      <template v-for="(d, i) in forwardDomainLabels" :key="d">
                        <span class="whitespace-nowrap">{{ d }}</span><template v-if="i < forwardDomainLabels.length - 1">, </template>
                      </template>
                    </span>
                  </template>
                </li>
              </ol>
            </aside>

            <details class="group rounded-lg border border-border">
              <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2.5 text-[15px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight class="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                Répondre depuis Gmail avec votre adresse
              </summary>
              <div class="space-y-4 border-t border-border px-4 pt-4 pb-5">
                <p class="text-sm text-muted-foreground">
                  Pour que vos réponses écrites dans Gmail sur ordinateur partent avec votre adresse {{ guides.settings.email }} (« Envoyer des e-mails en tant que ») :
                </p>
                <SettingsDevicesSteps :steps="guides.gmailSendAs" />
              </div>
            </details>
          </TabsContent>

          <!-- iPhone / iPad -->
          <TabsContent value="apple" class="space-y-6 outline-none">
            <div class="space-y-3">
              <p class="max-w-prose text-[15px] leading-relaxed">
                Le plus simple : un profil de configuration remplit tout pour vous, sauf le mot de passe, qui vous sera demandé à l'installation.
              </p>
              <Button as="a" :href="profileUrl" download class="h-11 w-full rounded-lg px-5 sm:w-auto">
                <Download class="size-4" aria-hidden="true" />
                Télécharger le profil de configuration
              </Button>
            </div>
            <SettingsDevicesSteps :steps="guides.appleProfile" />

            <details class="group rounded-lg border border-border">
              <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2.5 text-[15px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight class="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                Configurer à la main
              </summary>
              <div class="border-t border-border px-4 pt-4 pb-5">
                <SettingsDevicesSteps :steps="guides.appleManual" />
              </div>
            </details>
          </TabsContent>

          <!-- Outlook -->
          <TabsContent value="outlook" class="space-y-4 outline-none">
            <p class="max-w-prose text-sm text-muted-foreground">Outlook pour Windows, Mac, Android ou iPhone.</p>
            <SettingsDevicesSteps :steps="guides.outlook" />
          </TabsContent>

          <!-- Thunderbird -->
          <TabsContent value="thunderbird" class="space-y-4 outline-none">
            <SettingsDevicesSteps :steps="guides.thunderbird" />
          </TabsContent>

          <!-- Autre application -->
          <TabsContent value="other" class="space-y-5 outline-none">
            <SettingsDevicesSteps :steps="guides.other" />
            <SettingsDevicesServerTable :settings="guides.settings" />
          </TabsContent>
        </TabsRoot>
      </section>
    </template>
  </div>
</template>
