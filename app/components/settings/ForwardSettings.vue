<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { FiltersStatus, ForwardSettings } from '#shared/types/mail'

const api = useFiltersApi()
const confirmDialog = useTemplateRef('confirmDialog')

const loading = ref(true)
const saving = ref(false)
const status = ref<FiltersStatus | null>(null)

const form = reactive<ForwardSettings>({ enabled: false, address: '', keepCopy: true })

async function load(): Promise<void> {
  loading.value = true
  try {
    status.value = await api.status()
    if (status.value.available) {
      Object.assign(form, await api.forward())
    }
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible de charger le transfert.'))
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
    toast.success('Transfert enregistré.')
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, "Impossible d'enregistrer le transfert."))
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
      Les filtres ne sont pas disponibles sur ce serveur.
    </p>

    <form v-else class="flex flex-col gap-6" @submit.prevent="save">
      <div class="space-y-2">
        <Label for="forward-address">Transférer tous mes messages à</Label>
        <Input id="forward-address" v-model="form.address" type="email" class="h-11 text-base" placeholder="destinataire@mmi-troyes.fr" />
      </div>

      <label class="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox :model-value="form.keepCopy" @update:model-value="(v) => (form.keepCopy = v === true)" />
        Garder une copie
      </label>

      <div class="flex justify-end">
        <Button type="submit" class="h-11 rounded-lg px-6" :disabled="saving">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </Button>
      </div>
    </form>

    <FiltersConfirmIdentityDialog ref="confirmDialog" />
  </div>
</template>
