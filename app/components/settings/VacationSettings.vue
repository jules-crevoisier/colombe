<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Plus, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { FiltersStatus, VacationSettings } from '#shared/types/mail'

const { t } = useI18n()
const api = useFiltersApi()
const sieveStore = useSieveStore()
const confirmDialog = useTemplateRef('confirmDialog')

const loading = ref(true)
const saving = ref(false)
const status = ref<FiltersStatus | null>(null)
const newAddress = ref('')

function blank(): VacationSettings {
  return {
    enabled: false,
    from: null,
    until: null,
    subject: '',
    message: '',
    days: 7,
    addresses: [],
    replyFrom: '',
    incoming: 'keep',
    incomingAddress: null,
  }
}

const form = reactive<VacationSettings>(blank())

const INCOMING_OPTION_KEYS: { value: VacationSettings['incoming']; labelKey: string }[] = [
  { value: 'keep', labelKey: 'vacation.incomingOptions.keep' },
  { value: 'discard', labelKey: 'vacation.incomingOptions.discard' },
  { value: 'redirect', labelKey: 'vacation.incomingOptions.redirect' },
  { value: 'copy', labelKey: 'vacation.incomingOptions.copy' },
]
const INCOMING_OPTIONS = computed(() => INCOMING_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) })))

async function load(): Promise<void> {
  loading.value = true
  try {
    status.value = await sieveStore.loadStatus()
    if (status.value.available) {
      Object.assign(form, await sieveStore.loadVacation())
    }
  }
  catch (err) {
    toast.error(errorText(err, t('vacation.loadFailed')))
  }
  finally {
    loading.value = false
  }
}
onMounted(load)

function addAddress(): void {
  const value = newAddress.value.trim()
  if (!value) return
  if (!form.addresses.includes(value)) form.addresses.push(value)
  newAddress.value = ''
}
function removeAddress(address: string): void {
  form.addresses = form.addresses.filter(a => a !== address)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const payload: VacationSettings = { ...form }
    const saved = await confirmDialog.value!.withConfirmation(confirm => api.saveVacation(payload, confirm))
    Object.assign(form, saved)
    sieveStore.invalidateVacation()
    sieveStore.invalidateStatus()
    toast.success(t('vacation.saved'))
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, t('vacation.saveFailed')))
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
      <Skeleton class="h-40 w-full" />
    </div>

    <p v-else-if="!status?.available" class="text-sm text-muted-foreground">
      {{ t('vacation.unavailable') }}
    </p>

    <form v-else class="flex flex-col gap-6" @submit.prevent="save">
      <label class="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox :model-value="form.enabled" @update:model-value="(v) => (form.enabled = v === true)" />
        {{ t('vacation.enable') }}
      </label>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="vacation-from">{{ t('vacation.from') }}</Label>
          <Input id="vacation-from" :model-value="form.from ?? ''" type="date" class="h-11 text-base" @update:model-value="(v) => (form.from = String(v) || null)" />
        </div>
        <div class="space-y-2">
          <Label for="vacation-until">{{ t('vacation.until') }}</Label>
          <Input id="vacation-until" :model-value="form.until ?? ''" type="date" class="h-11 text-base" @update:model-value="(v) => (form.until = String(v) || null)" />
        </div>
      </div>

      <div class="space-y-2">
        <Label for="vacation-subject">{{ t('vacation.subject') }}</Label>
        <Input id="vacation-subject" v-model="form.subject" class="h-11 text-base" />
      </div>

      <div class="space-y-2">
        <Label for="vacation-message">{{ t('vacation.message') }}</Label>
        <Textarea id="vacation-message" v-model="form.message" class="min-h-40 text-base" />
      </div>

      <div class="space-y-2">
        <Label for="vacation-days">{{ t('vacation.frequencyLabel') }}</Label>
        <div class="flex items-center gap-2">
          <Input id="vacation-days" :model-value="form.days" type="number" min="1" max="30" class="h-11 w-24 text-base" @update:model-value="(v) => (form.days = Number(v) || 1)" />
          <span class="text-sm text-muted-foreground">{{ t('vacation.daysUnit') }}</span>
        </div>
      </div>

      <div class="space-y-2">
        <Label for="vacation-address">{{ t('vacation.otherAddresses') }}</Label>
        <div class="flex gap-2">
          <Input id="vacation-address" v-model="newAddress" type="email" class="h-11 flex-1 text-base" @keydown.enter.prevent="addAddress" />
          <Button type="button" variant="outline" class="h-11 rounded-lg px-4" @click="addAddress">
            <Plus class="size-4" aria-hidden="true" /> {{ t('common.add') }}
          </Button>
        </div>
        <ul v-if="form.addresses.length" class="flex flex-col gap-1">
          <li v-for="address in form.addresses" :key="address" class="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 text-sm">
            {{ address }}
            <MailIconButton :icon="X" :label="t('vacation.remove')" @click="removeAddress(address)" />
          </li>
        </ul>
      </div>

      <fieldset class="space-y-2">
        <legend class="mb-1 text-sm font-medium">{{ t('vacation.incomingLegend') }}</legend>
        <label v-for="opt in INCOMING_OPTIONS" :key="opt.value" class="flex min-h-11 cursor-pointer items-center gap-3">
          <input v-model="form.incoming" type="radio" name="vacation-incoming" :value="opt.value" class="size-5 shrink-0 accent-[var(--primary)]">
          {{ opt.label }}
        </label>
        <Input
          v-if="form.incoming === 'redirect' || form.incoming === 'copy'"
          :model-value="form.incomingAddress ?? ''"
          type="email"
          class="h-11 text-base"
          :aria-label="t('vacation.incomingAddressLabel')"
          @update:model-value="(v) => (form.incomingAddress = String(v) || null)"
        />
      </fieldset>

      <div class="flex justify-end">
        <Button type="submit" class="h-11 rounded-lg px-6" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>
    </form>

    <FiltersConfirmIdentityDialog ref="confirmDialog" />
  </div>
</template>
