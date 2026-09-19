<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { FiltersStatus, ForwardSettings } from '#shared/types/mail'

const { t } = useI18n()
const api = useFiltersApi()
const devicesApi = useDevicesApi()
const sieveStore = useSieveStore()
const confirmDialog = useTemplateRef('confirmDialog')

const loading = ref(true)
const saving = ref(false)
const status = ref<FiltersStatus | null>(null)
/** Domaines autorisés comme destination (MAIL_FORWARD_DOMAINS) ; vide tant qu'inconnus. */
const forwardDomains = ref<string[]>([])

const form = reactive<ForwardSettings>({ enabled: false, address: '', keepCopy: true })
const placeholder = computed(() => forwardPlaceholder(forwardDomains.value))
const domainLabels = computed(() => formatDomains(forwardDomains.value))

async function loadDomains(): Promise<void> {
  try {
    forwardDomains.value = (await devicesApi.settings()).forwardDomains
  }
  catch {
    // Indication facultative : le serveur refusera de toute façon un domaine non autorisé.
  }
}

async function load(): Promise<void> {
  loading.value = true
  void loadDomains()
  try {
    status.value = await sieveStore.loadStatus()
    if (status.value.available) {
      Object.assign(form, await sieveStore.loadForward())
    }
  }
  catch (err) {
    toast.error(errorText(err, t('forwarding.loadFailed')))
  }
  finally {
    loading.value = false
  }
}
onMounted(load)

async function save(): Promise<void> {
  saving.value = true
  try {
    // Pas de case « Activer » distincte (PLAN-v4 F « Interface » ne liste que l'adresse,
    // « Garder une copie » et « Enregistrer ») : le transfert est actif dès qu'une adresse est saisie.
    const payload: ForwardSettings = { ...form, enabled: form.address.trim().length > 0 }
    const saved = await confirmDialog.value!.withConfirmation(confirm => api.saveForward(payload, confirm))
    Object.assign(form, saved)
    sieveStore.invalidateForward()
    sieveStore.invalidateStatus()
    toast.success(t('forwarding.saved'))
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, t('forwarding.saveFailed')))
    }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="space-y-3">
      <Skeleton class="h-11 w-full" />
    </div>

    <p v-else-if="!status?.available" class="text-sm text-muted-foreground">
      {{ t('forwarding.unavailable') }}
    </p>

    <form v-else class="flex flex-col gap-6" @submit.prevent="save">
      <div class="space-y-2">
        <Label for="forward-address">{{ t('forwarding.addressLabel') }}</Label>
        <Input
          id="forward-address"
          v-model="form.address"
          type="email"
          class="h-11 text-base"
          :placeholder="placeholder"
          :aria-describedby="forwardDomains.length ? 'forward-domains' : undefined"
        />
        <p v-if="forwardDomains.length" id="forward-domains" class="text-sm text-muted-foreground">
          {{ t('forwarding.allowedDomainsPrefix') }}
          <template v-for="(d, i) in domainLabels" :key="d">
            <span class="whitespace-nowrap">{{ d }}</span><template v-if="i < domainLabels.length - 1">, </template>
          </template>
        </p>
      </div>

      <label class="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox :model-value="form.keepCopy" @update:model-value="(v) => (form.keepCopy = v === true)" />
        {{ t('forwarding.keepCopy') }}
      </label>

      <div class="flex justify-end">
        <Button type="submit" class="h-11 rounded-lg px-6" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>
    </form>

    <FiltersConfirmIdentityDialog ref="confirmDialog" />
  </div>
</template>
