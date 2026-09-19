<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Plus } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { CannedResponse } from '#shared/types/mail'

const MAX_RESPONSES = 100
const MAX_NAME_LENGTH = 100

const api = useSettingsApi()
const { t } = useI18n()

const responses = ref<CannedResponse[]>([])
const loading = ref(true)
const selectedId = ref<number | null>(null)
const creating = ref(false)
const saving = ref(false)
const deleteDialogOpen = ref(false)

const name = ref('')
const html = ref('')

const selected = computed(() => responses.value.find(r => r.id === selectedId.value) ?? null)
const canAdd = computed(() => responses.value.length < MAX_RESPONSES)

async function load() {
  loading.value = true
  try {
    responses.value = await api.responses()
  }
  catch (err) {
    toast.error(errorText(err, t('settings.responses.loadError')))
  }
  finally {
    loading.value = false
  }
}

function select(id: number) {
  const response = responses.value.find(r => r.id === id)
  if (!response) return
  creating.value = false
  selectedId.value = id
  name.value = response.name
  html.value = response.html
}

function startCreate() {
  creating.value = true
  selectedId.value = null
  name.value = ''
  html.value = ''
}

async function save() {
  if (!name.value.trim()) {
    toast.error(t('settings.responses.form.nameRequired'))
    return
  }
  saving.value = true
  try {
    if (creating.value) {
      const created = await api.createResponse({ name: name.value.trim(), html: html.value })
      responses.value.push(created)
      creating.value = false
      selectedId.value = created.id
      toast.success(t('settings.responses.created'))
    }
    else if (selectedId.value != null) {
      const updated = await api.updateResponse(selectedId.value, { name: name.value.trim(), html: html.value })
      const index = responses.value.findIndex(r => r.id === updated.id)
      if (index >= 0) responses.value[index] = updated
      toast.success(t('settings.responses.saved'))
    }
  }
  catch (err) {
    toast.error(errorText(err, t('settings.responses.saveError')))
  }
  finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (selectedId.value == null) return
  try {
    await api.deleteResponse(selectedId.value)
    responses.value = responses.value.filter(r => r.id !== selectedId.value)
    deleteDialogOpen.value = false
    selectedId.value = null
    creating.value = false
    name.value = ''
    html.value = ''
    toast.success(t('settings.responses.deleted'))
  }
  catch (err) {
    deleteDialogOpen.value = false
    toast.error(errorText(err, t('settings.responses.deleteError')))
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="space-y-3">
      <Skeleton class="h-11 w-full" />
      <Skeleton class="h-40 w-full" />
    </div>

    <template v-else>
      <p v-if="!responses.length && !creating" class="text-sm text-muted-foreground">{{ t('settings.responses.empty') }}</p>

      <div v-if="responses.length" class="flex flex-col gap-2">
        <button
          v-for="response in responses"
          :key="response.id"
          type="button"
          class="flex min-h-11 items-center rounded-lg border px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-accent"
          :class="response.id === selectedId && !creating ? 'border-primary bg-accent' : 'border-border'"
          @click="select(response.id)"
        >
          {{ response.name }}
        </button>
      </div>

      <Button variant="outline" class="h-11 justify-start rounded-lg" :disabled="!canAdd" @click="startCreate">
        <Plus class="size-4" aria-hidden="true" />
        {{ t('settings.responses.add') }}
      </Button>
      <p v-if="!canAdd" class="text-xs text-muted-foreground">{{ t('settings.responses.limitReached', { n: MAX_RESPONSES }) }}</p>

      <form v-if="creating || selected" class="flex flex-col gap-6 rounded-xl border border-border p-4" @submit.prevent="save">
        <div class="space-y-2">
          <Label for="response-name">{{ t('settings.responses.form.name') }}</Label>
          <Input id="response-name" v-model="name" class="h-11 text-base" :maxlength="MAX_NAME_LENGTH" required />
        </div>

        <div class="space-y-2">
          <Label for="response-text">{{ t('settings.responses.form.text') }}</Label>
          <div class="flex min-h-56 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel focus-within:ring-2 focus-within:ring-ring">
            <MailRichEditor id="response-text" v-model:html="html" :label="t('settings.responses.form.text')" :placeholder="t('settings.responses.form.textPlaceholder')" />
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button v-if="selected" type="button" variant="destructive" class="h-11 rounded-lg px-6" @click="deleteDialogOpen = true">
            {{ t('common.delete') }}
          </Button>
          <Button type="submit" class="h-11 rounded-lg px-6" :disabled="saving">
            {{ saving ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </form>

      <AlertDialog v-model:open="deleteDialogOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('settings.responses.deleteConfirmTitle') }}</AlertDialogTitle>
            <AlertDialogDescription>{{ t('settings.responses.deleteConfirmDescription') }}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
            <AlertDialogAction @click="confirmDelete">{{ t('common.delete') }}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </template>
  </div>
</template>
