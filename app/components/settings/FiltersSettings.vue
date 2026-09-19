<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ChevronDown, ChevronUp, Plus, Upload } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { FilterRule, FilterSet, FiltersStatus } from '#shared/types/mail'

const { t } = useI18n()
const api = useFiltersApi()
const mail = useMailStore()
const filtersStore = useFiltersStore()
const sieveStore = useSieveStore()
const confirmDialog = useTemplateRef('confirmDialog')
const importInput = useTemplateRef('importInput')

const loading = ref(true)
const status = ref<FiltersStatus | null>(null)
const activeRules = ref<FilterRule[]>([])
const activeSetName = computed(() => status.value?.sets.find(s => s.active)?.name ?? null)

const advancedOpen = ref(false)
const selectedSetName = ref('')
const selectedSet = ref<FilterSet | null>(null)
const scriptEditorOpen = ref(false)
const scriptDraft = ref('')
const savingScript = ref(false)
const importing = ref(false)
const activating = ref(false)
const deleteSetDialogOpen = ref(false)

const newSetDialogOpen = ref(false)
const newSetName = ref('')
const newSetCopyFrom = ref('')
const creatingSet = ref(false)

function folderName(path: string): string {
  const folder = mail.byPath(path)
  return folder ? folderLabel(folder) : path
}

async function loadSelectedSet(): Promise<void> {
  scriptEditorOpen.value = false
  if (!selectedSetName.value) {
    selectedSet.value = null
    scriptDraft.value = ''
    return
  }
  try {
    selectedSet.value = await api.getSet(selectedSetName.value)
    scriptDraft.value = selectedSet.value.script
  }
  catch (err) {
    toast.error(errorText(err, t('filters.sets.loadFailed')))
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    status.value = await sieveStore.loadStatus()
    if (status.value.available) {
      if (!mail.loaded) await mail.loadFolders()
      const active = activeSetName.value
      activeRules.value = active ? (await api.getSet(active)).rules : []
      selectedSetName.value = active ?? status.value.sets[0]?.name ?? ''
      await loadSelectedSet()
    }
  }
  catch (err) {
    toast.error(errorText(err, t('filters.list.loadFailed')))
  }
  finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => filtersStore.savedTick, load)
watch(selectedSetName, loadSelectedSet)

async function persistActiveRules(rules: FilterRule[], successMessage?: string): Promise<void> {
  if (!activeSetName.value) return
  try {
    // Le serveur seul sait si la confirmation est requise : on tente sans, le wrapper
    // rouvre la boîte seulement si le serveur répond 403.
    const name = activeSetName.value
    const saved = await confirmDialog.value!.withConfirmation(confirm => api.saveSetRules(name, rules, confirm))
    activeRules.value = saved.rules
    sieveStore.invalidateStatus()
    if (successMessage) toast.success(successMessage)
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, t('filters.list.saveFailed')))
    }
  }
}

function toggleEnabled(rule: FilterRule, value: boolean): void {
  void persistActiveRules(activeRules.value.map(r => (r.id === rule.id ? { ...r, enabled: value } : r)))
}
function deleteRule(rule: FilterRule): void {
  void persistActiveRules(activeRules.value.filter(r => r.id !== rule.id), t('filters.list.deleted'))
}
function moveRule(rule: FilterRule, direction: -1 | 1): void {
  const index = activeRules.value.findIndex(r => r.id === rule.id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= activeRules.value.length) return
  const updated = [...activeRules.value]
  const [item] = updated.splice(index, 1)
  updated.splice(target, 0, item as FilterRule)
  void persistActiveRules(updated)
}

function openNewFilter(): void {
  filtersStore.openCreate()
}
function openEditFilter(rule: FilterRule): void {
  filtersStore.openEdit(rule)
}

// ─── Mode avancé : ensembles ───

async function createSet(): Promise<void> {
  if (!newSetName.value.trim()) return
  creatingSet.value = true
  try {
    const created = await api.createSet(newSetName.value.trim(), newSetCopyFrom.value || undefined)
    toast.success(t('filters.sets.created'))
    newSetDialogOpen.value = false
    newSetName.value = ''
    newSetCopyFrom.value = ''
    sieveStore.invalidateStatus()
    await load()
    selectedSetName.value = created.name
  }
  catch (err) {
    toast.error(errorText(err, t('filters.sets.createFailed')))
  }
  finally {
    creatingSet.value = false
  }
}

async function activateSelectedSet(): Promise<void> {
  if (!selectedSetName.value) return
  activating.value = true
  try {
    await api.activateSet(selectedSetName.value)
    toast.success(t('filters.sets.activated'))
    sieveStore.invalidateStatus()
    await load()
  }
  catch (err) {
    toast.error(errorText(err, t('filters.sets.activateFailed')))
  }
  finally {
    activating.value = false
  }
}

async function confirmDeleteSet(): Promise<void> {
  if (!selectedSetName.value) return
  try {
    await api.deleteSet(selectedSetName.value)
    toast.success(t('filters.sets.deleted'))
    deleteSetDialogOpen.value = false
    sieveStore.invalidateStatus()
    await load()
  }
  catch (err) {
    deleteSetDialogOpen.value = false
    toast.error(errorText(err, t('filters.sets.deleteFailed')))
  }
}

function triggerImport(): void {
  importInput.value?.click()
}
async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    await confirmDialog.value!.withConfirmation(confirm => api.importSet(file, confirm))
    toast.success(t('filters.sets.imported'))
    sieveStore.invalidateStatus()
    await load()
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, t('filters.sets.importFailed')))
    }
  }
  finally {
    importing.value = false
  }
}

async function saveScript(): Promise<void> {
  if (!selectedSetName.value) return
  savingScript.value = true
  try {
    const saved = await confirmDialog.value!.withConfirmation(confirm => api.saveSetScript(selectedSetName.value, scriptDraft.value, confirm))
    selectedSet.value = saved
    toast.success(t('filters.sets.scriptSaved'))
    sieveStore.invalidateStatus()
    await load()
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, t('filters.sets.scriptSaveFailed')))
    }
  }
  finally {
    savingScript.value = false
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
      {{ t('filters.unavailable') }}
    </p>

    <template v-else>
      <div class="space-y-2">
        <ul :aria-label="t('filters.list.ariaLabel')" class="flex flex-col gap-2">
          <li v-for="(rule, index) in activeRules" :key="rule.id" class="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:gap-3">
            <Switch :model-value="rule.enabled" :aria-label="t('filters.list.activeLabel')" @update:model-value="(v: boolean) => toggleEnabled(rule, v)" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ describeRule(rule, folderName) }}</span>
            <div class="flex flex-wrap items-center gap-1">
              <MailIconButton :icon="ChevronUp" :label="t('filters.list.moveUp')" :disabled="index === 0" @click="moveRule(rule, -1)" />
              <MailIconButton :icon="ChevronDown" :label="t('filters.list.moveDown')" :disabled="index === activeRules.length - 1" @click="moveRule(rule, 1)" />
              <Button variant="outline" class="h-11 rounded-lg px-4" @click="openEditFilter(rule)">{{ t('common.edit') }}</Button>
              <Button variant="outline" class="h-11 rounded-lg px-4" @click="deleteRule(rule)">{{ t('common.delete') }}</Button>
            </div>
          </li>
        </ul>
        <p v-if="activeRules.length === 0" class="text-sm text-muted-foreground">{{ t('filters.list.empty') }}</p>

        <Button variant="outline" class="h-11 justify-start rounded-lg" @click="openNewFilter">
          <Plus class="size-4" aria-hidden="true" /> {{ t('filters.list.newFilter') }}
        </Button>
      </div>

      <div class="border-t border-border pt-4">
        <button
          type="button"
          class="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-medium"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
        >
          {{ t('filters.advancedMode') }}
          <ChevronDown class="size-4 shrink-0 transition-transform" :class="advancedOpen ? 'rotate-180' : ''" aria-hidden="true" />
        </button>

        <div v-if="advancedOpen" class="mt-4 space-y-6">
          <div class="space-y-2">
            <Label for="filter-set-select">{{ t('filters.sets.label') }}</Label>
            <Select v-model="selectedSetName">
              <SelectTrigger id="filter-set-select" class="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="set in status.sets" :key="set.name" :value="set.name">
                  {{ set.name }}{{ set.active ? t('filters.sets.activeSuffix') : '' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button variant="outline" class="h-11 rounded-lg px-5" @click="newSetDialogOpen = true">{{ t('filters.sets.new') }}</Button>
            <Button variant="outline" class="h-11 rounded-lg px-5" :disabled="!selectedSetName || activating" @click="activateSelectedSet">{{ t('common.enable') }}</Button>
            <Button variant="outline" class="h-11 rounded-lg px-5" :disabled="!selectedSetName" @click="deleteSetDialogOpen = true">{{ t('filters.sets.delete') }}</Button>
            <Button v-if="selectedSetName" variant="outline" class="h-11 rounded-lg px-5" as-child>
              <a :href="api.exportUrl(selectedSetName)" download>{{ t('common.export') }}</a>
            </Button>
            <Button variant="outline" class="h-11 rounded-lg px-5" :disabled="importing" @click="triggerImport">
              <Upload class="size-4" aria-hidden="true" /> {{ t('filters.sets.import') }}
            </Button>
            <input ref="importInput" type="file" accept=".sieve" class="hidden" @change="onImportFile">
            <Button variant="outline" class="h-11 rounded-lg px-5" :disabled="!selectedSet" :aria-expanded="scriptEditorOpen" @click="scriptEditorOpen = !scriptEditorOpen">
              {{ t('filters.sets.editScript') }}
            </Button>
          </div>

          <div v-if="selectedSet && scriptEditorOpen" class="space-y-2">
            <Label for="filter-script">{{ t('filters.sets.scriptLabel') }}</Label>
            <Textarea id="filter-script" v-model="scriptDraft" class="min-h-56 font-mono text-sm" spellcheck="false" />
            <Button class="h-11 rounded-lg px-6" :disabled="savingScript" @click="saveScript">
              {{ savingScript ? t('common.saving') : t('filters.sets.saveScript') }}
            </Button>
          </div>
        </div>
      </div>

      <!-- Nouvel ensemble -->
      <Dialog v-model:open="newSetDialogOpen">
        <DialogContent class="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{{ t('filters.sets.new') }}</DialogTitle>
          </DialogHeader>
          <div class="space-y-4">
            <div class="space-y-2">
              <Label for="new-set-name">{{ t('filters.sets.nameLabel') }}</Label>
              <Input id="new-set-name" v-model="newSetName" class="h-11 text-base" />
            </div>
            <div class="space-y-2">
              <Label for="new-set-copy">{{ t('filters.sets.copyFromLabel') }}</Label>
              <Select v-model="newSetCopyFrom">
                <SelectTrigger id="new-set-copy" class="h-11 w-full text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{{ t('filters.sets.none') }}</SelectItem>
                  <SelectItem v-for="set in status?.sets ?? []" :key="set.name" :value="set.name">{{ set.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter class="sm:justify-end">
            <Button variant="outline" class="h-11 rounded-lg px-6" @click="newSetDialogOpen = false">{{ t('common.cancel') }}</Button>
            <Button class="h-11 rounded-lg px-6" :disabled="!newSetName.trim() || creatingSet" @click="createSet">{{ t('common.create') }}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog v-model:open="deleteSetDialogOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('filters.sets.deleteConfirmTitle') }}</AlertDialogTitle>
            <AlertDialogDescription>{{ t('filters.sets.deleteConfirmDescription') }}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
            <AlertDialogAction @click="confirmDeleteSet">{{ t('filters.sets.delete') }}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </template>

    <FiltersConfirmIdentityDialog ref="confirmDialog" />
  </div>
</template>
