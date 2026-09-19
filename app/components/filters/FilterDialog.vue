<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Plus, X } from '@lucide/vue'
import type { FilterAction, FilterCondition, FilterField, FilterRule } from '#shared/types/mail'

const filtersStore = useFiltersStore()
const sieveStore = useSieveStore()
const mail = useMailStore()
const api = useFiltersApi()
const confirmDialog = useTemplateRef('confirmDialog')
const { addressExample } = useSiteConfig()

const draft = reactive<FilterRule>(emptyRule())
const advancedMode = ref(false)
const applyToExisting = ref(false)
const saving = ref(false)
const capabilities = ref<string[]>([])

const isEditing = computed(() => filtersStore.editingRule !== null)
const folders = computed(() => mail.folders)
const folderName = (path: string): string => mail.byPath(path)?.name ?? path
const archivePath = computed(() => mail.special('archive')?.path ?? 'Archives')

const ACTION_TYPES: { value: FilterAction['type']; label: string }[] = [
  { value: 'move', label: 'Déplacer vers' },
  { value: 'copy', label: 'Copier vers' },
  { value: 'mark-read', label: 'Marquer comme lu' },
  { value: 'flag', label: 'Suivre' },
  { value: 'add-flag', label: 'Ajouter le mot-clé' },
  { value: 'redirect', label: 'Rediriger vers' },
  { value: 'reject', label: 'Rejeter avec le message' },
  { value: 'add-header', label: "Ajouter l'en-tête" },
  { value: 'notify', label: "M'avertir à" },
  { value: 'delete', label: 'Supprimer' },
  { value: 'stop', label: 'Arrêter les filtres suivants' },
]

const FIELD_ORDER: FilterField[] = ['from', 'to-cc', 'subject', 'size', 'header', 'body', 'date', 'spam']

const availableFields = computed(() => FIELD_ORDER.filter(f => isSupported(capabilities.value, fieldCapabilities(f))))
const availableActionTypes = computed(() => ACTION_TYPES.filter(a => isSupported(capabilities.value, actionCapabilities(a.value))))

// ─── Chargement à l'ouverture ───

async function loadCapabilities(): Promise<void> {
  try {
    const status = await sieveStore.loadStatus()
    capabilities.value = status.capabilities
  }
  catch {
    capabilities.value = []
  }
}

/** Une règle "simple" (Gmail) : conditions contains sur from/to-cc/subject/body, ET, actions courantes. */
function looksSimple(rule: FilterRule): boolean {
  if (rule.match !== 'all') return false
  const simpleConditionOk = rule.conditions.every(c =>
    (c.field === 'from' || c.field === 'to-cc' || c.field === 'subject') && c.op === 'contains'
    || (c.field === 'body' && (c.op === 'contains' || c.op === 'not-contains')))
  const simpleActionOk = rule.actions.every(a => a.type === 'move' || a.type === 'mark-read' || a.type === 'flag' || a.type === 'delete' || a.type === 'redirect')
  return simpleConditionOk && simpleActionOk
}

function loadDraft(): void {
  const source = filtersStore.editingRule
  if (source) {
    draft.id = source.id
    draft.name = source.name
    draft.enabled = source.enabled
    draft.match = source.match
    draft.conditions = source.conditions.map(c => ({ ...c }))
    draft.actions = source.actions.map(a => ({ ...a }) as FilterAction)
    advancedMode.value = !looksSimple(source)
  }
  else {
    draft.id = newFilterId()
    draft.name = ''
    draft.enabled = true
    draft.match = 'all'
    draft.conditions = []
    draft.actions = []
    if (filtersStore.prefill?.from) draft.conditions.push({ field: 'from', op: 'contains', value: filtersStore.prefill.from })
    if (filtersStore.prefill?.to) draft.conditions.push({ field: 'to-cc', op: 'contains', value: filtersStore.prefill.to })
    if (filtersStore.prefill?.subject) draft.conditions.push({ field: 'subject', op: 'contains', value: filtersStore.prefill.subject })
    if (filtersStore.prefill?.containsWords) draft.conditions.push({ field: 'body', op: 'contains', value: filtersStore.prefill.containsWords })
    advancedMode.value = false
  }
  applyToExisting.value = false
}

watch(() => filtersStore.dialogOpen, async (open) => {
  if (!open) return
  loadDraft()
  if (!mail.loaded) await mail.loadFolders()
  await loadCapabilities()
})

// ─── Mode simple : conditions ───

function findConditionIndex(pred: (c: FilterCondition) => boolean): number {
  return draft.conditions.findIndex(pred)
}
function setTextCondition(pred: (c: FilterCondition) => boolean, condition: FilterCondition): void {
  const idx = findConditionIndex(pred)
  if (!condition.value.trim()) {
    if (idx >= 0) draft.conditions.splice(idx, 1)
    return
  }
  if (idx >= 0) draft.conditions.splice(idx, 1, condition)
  else draft.conditions.push(condition)
}
function simpleTextModel(pred: (c: FilterCondition) => boolean, field: FilterField, op: FilterCondition['op']) {
  return computed({
    get: () => draft.conditions.find(pred)?.value ?? '',
    set: (v: string) => setTextCondition(pred, { field, op, value: v }),
  })
}
const simpleFrom = simpleTextModel(c => c.field === 'from' && c.op === 'contains', 'from', 'contains')
const simpleTo = simpleTextModel(c => c.field === 'to-cc' && c.op === 'contains', 'to-cc', 'contains')
const simpleSubject = simpleTextModel(c => c.field === 'subject' && c.op === 'contains', 'subject', 'contains')
const simpleContains = simpleTextModel(c => c.field === 'body' && c.op === 'contains', 'body', 'contains')
const simpleNotContains = simpleTextModel(c => c.field === 'body' && c.op === 'not-contains', 'body', 'not-contains')

// ─── Mode simple : actions ───

function findActionIndex(pred: (a: FilterAction) => boolean): number {
  return draft.actions.findIndex(pred)
}
function setAction(pred: (a: FilterAction) => boolean, action: FilterAction): void {
  const idx = findActionIndex(pred)
  if (idx >= 0) draft.actions.splice(idx, 1, action)
  else draft.actions.push(action)
}
function removeAction(pred: (a: FilterAction) => boolean): void {
  const idx = findActionIndex(pred)
  if (idx >= 0) draft.actions.splice(idx, 1)
}
function boolActionModel(pred: (a: FilterAction) => boolean, factory: () => FilterAction) {
  return computed({
    get: () => draft.actions.some(pred),
    set: (v: boolean) => (v ? setAction(pred, factory()) : removeAction(pred)),
  })
}

const archiveChecked = boolActionModel(a => a.type === 'move' && a.folder === archivePath.value, () => ({ type: 'move', folder: archivePath.value }))
const markReadChecked = boolActionModel(a => a.type === 'mark-read', () => ({ type: 'mark-read' }))
const flagChecked = boolActionModel(a => a.type === 'flag', () => ({ type: 'flag' }))
const deleteChecked = boolActionModel(a => a.type === 'delete', () => ({ type: 'delete' }))

const classifyFolder = computed({
  get: () => (draft.actions.find(a => a.type === 'move' && a.folder !== archivePath.value) as Extract<FilterAction, { type: 'move' | 'copy' }> | undefined)?.folder ?? '',
  set: (v: string) => {
    if (!v) { removeAction(a => a.type === 'move' && a.folder !== archivePath.value); return }
    setAction(a => a.type === 'move' && a.folder !== archivePath.value, { type: 'move', folder: v })
  },
})

/** Case « Classer dans le dossier » (docs/PLAN-v4.md F.2) : révèle la liste des dossiers. */
const classifyOpen = ref(false)
const classifyChecked = computed({
  get: () => classifyOpen.value || !!classifyFolder.value,
  set: (v: boolean) => {
    classifyOpen.value = v
    if (!v) classifyFolder.value = ''
  },
})

const redirectChecked = boolActionModel(a => a.type === 'redirect', () => ({ type: 'redirect', address: '', keepCopy: true }))
const redirectAddress = computed({
  get: () => (draft.actions.find(a => a.type === 'redirect') as Extract<FilterAction, { type: 'redirect' }> | undefined)?.address ?? '',
  set: (v: string) => {
    const existing = draft.actions.find(a => a.type === 'redirect') as Extract<FilterAction, { type: 'redirect' }> | undefined
    setAction(a => a.type === 'redirect', { type: 'redirect', address: v, keepCopy: existing?.keepCopy ?? true })
  },
})

// ─── Mode avancé ───

const matchMode = computed({
  get: (): 'all' | 'any' | 'everything' => (draft.conditions.length === 0 ? 'everything' : draft.match),
  set: (v: 'all' | 'any' | 'everything') => {
    if (v === 'everything') draft.conditions = []
    else draft.match = v
  },
})

function addCondition(): void {
  const field = availableFields.value[0] ?? 'from'
  draft.conditions.push({ field, op: OPS_BY_FIELD[field][0] ?? 'contains', value: '' })
}
function removeConditionAt(index: number): void {
  draft.conditions.splice(index, 1)
}
function onFieldChange(index: number, field: FilterField): void {
  const condition = draft.conditions[index]
  if (!condition) return
  condition.field = field
  condition.op = OPS_BY_FIELD[field][0] ?? 'contains'
  if (field !== 'header') condition.header = undefined
}

function addAction(): void {
  const type = availableActionTypes.value[0]?.value ?? 'move'
  draft.actions.push(defaultActionFor(type))
}
function defaultActionFor(type: FilterAction['type']): FilterAction {
  switch (type) {
    case 'move':
    case 'copy': return { type, folder: folders.value[0]?.path ?? '' }
    case 'add-flag': return { type: 'add-flag', flag: '' }
    case 'redirect': return { type: 'redirect', address: '', keepCopy: true }
    case 'reject': return { type: 'reject', message: '' }
    case 'add-header': return { type: 'add-header', name: '', value: '' }
    case 'notify': return { type: 'notify', address: '', message: '' }
    default: return { type }
  }
}
function removeActionAt(index: number): void {
  draft.actions.splice(index, 1)
}
function onActionTypeChange(index: number, type: FilterAction['type']): void {
  draft.actions.splice(index, 1, defaultActionFor(type))
}

// ─── Enregistrement ───

function close(): void {
  filtersStore.close()
}

async function save(): Promise<void> {
  if (draft.actions.length === 0) {
    toast.error('Ajoutez au moins une action.')
    return
  }
  if (!draft.name.trim()) draft.name = describeRule(draft, folderName).slice(0, 200)

  saving.value = true
  try {
    const status = await sieveStore.loadStatus()
    if (!status.available) {
      toast.error('Les filtres ne sont pas disponibles sur ce serveur.')
      return
    }
    const activeSummary = status.sets.find(s => s.active)
    let setName = activeSummary?.name ?? null
    let existingRules: FilterRule[] = []
    if (setName) {
      const set = await api.getSet(setName)
      existingRules = set.rules
    }
    else {
      const created = await api.createSet('colombe')
      setName = created.name
      existingRules = created.rules
      await api.activateSet(created.name)
      sieveStore.invalidateStatus()
    }

    const idx = existingRules.findIndex(r => r.id === draft.id)
    const plain: FilterRule = { id: draft.id, name: draft.name, enabled: draft.enabled, match: draft.match, conditions: [...draft.conditions], actions: [...draft.actions] }
    const rules = idx >= 0
      ? existingRules.map(r => (r.id === draft.id ? plain : r))
      : [...existingRules, plain]

    const name = setName
    // Le serveur seul sait si la confirmation est requise (redirection/notification nouvelle ou modifiée) :
    // on tente sans, et le wrapper rouvre la boîte seulement si le serveur répond 403.
    await confirmDialog.value!.withConfirmation(confirm => api.saveSetRules(name, rules, confirm))
    sieveStore.invalidateStatus()

    toast.success(isEditing.value ? 'Filtre enregistré.' : 'Filtre créé.')
    filtersStore.notifySaved()

    if (applyToExisting.value) {
      const result = await api.apply(plain)
      toast.success(`Filtre appliqué à ${result.applied} message(s)`)
    }
    close()
  }
  catch (err) {
    if (!(err instanceof Error && err.name === 'ConfirmCancelled')) {
      toast.error(errorText(err, "Impossible d'enregistrer le filtre."))
    }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="filtersStore.dialogOpen" @update:open="(v: boolean) => { if (!v) close() }">
    <DialogContent class="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 sm:max-w-lg">
      <DialogHeader class="border-b border-border px-6 py-4">
        <DialogTitle>{{ isEditing ? 'Modifier le filtre' : 'Nouveau filtre' }}</DialogTitle>
        <DialogDescription class="sr-only">Critères des messages concernés et actions à leur appliquer.</DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-4">
        <label class="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span class="text-sm font-medium">Mode avancé</span>
          <Switch :model-value="advancedMode" @update:model-value="(v: boolean) => (advancedMode = v)" />
        </label>

        <!-- ─── Mode simple ─── -->
        <template v-if="!advancedMode">
          <div class="space-y-4">
            <div class="space-y-2">
              <Label for="filter-from">De</Label>
              <Input id="filter-from" v-model="simpleFrom" class="h-11 text-base" placeholder="expediteur@exemple.fr" />
            </div>
            <div class="space-y-2">
              <Label for="filter-to">À</Label>
              <Input id="filter-to" v-model="simpleTo" class="h-11 text-base" :placeholder="addressExample" />
            </div>
            <div class="space-y-2">
              <Label for="filter-subject">Objet</Label>
              <Input id="filter-subject" v-model="simpleSubject" class="h-11 text-base" />
            </div>
            <div class="space-y-2">
              <Label for="filter-contains">Contient les mots</Label>
              <Input id="filter-contains" v-model="simpleContains" class="h-11 text-base" />
            </div>
            <div class="space-y-2">
              <Label for="filter-not-contains">Ne contient pas</Label>
              <Input id="filter-not-contains" v-model="simpleNotContains" class="h-11 text-base" />
            </div>
          </div>

          <div class="space-y-3 border-t border-border pt-4">
            <p class="text-sm font-medium">Actions</p>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox :model-value="archiveChecked" @update:model-value="(v) => (archiveChecked = v === true)" />
              Ignorer la boîte de réception (archiver)
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox :model-value="markReadChecked" @update:model-value="(v) => (markReadChecked = v === true)" />
              Marquer comme lu
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox :model-value="flagChecked" @update:model-value="(v) => (flagChecked = v === true)" />
              Suivre
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox :model-value="classifyChecked" @update:model-value="(v) => (classifyChecked = v === true)" />
              Classer dans le dossier
            </label>
            <Select v-if="classifyChecked" :model-value="classifyFolder || undefined" @update:model-value="(v) => (classifyFolder = String(v))">
              <SelectTrigger id="filter-classify" aria-label="Dossier de destination" class="h-11 w-full text-base">
                <SelectValue placeholder="Choisir un dossier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="folder in folders" :key="folder.path" :value="folder.path">{{ folder.name }}</SelectItem>
              </SelectContent>
            </Select>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox :model-value="redirectChecked" @update:model-value="(v) => (redirectChecked = v === true)" />
              Transférer à
            </label>
            <Input v-if="redirectChecked" v-model="redirectAddress" type="email" class="h-11 text-base" :placeholder="addressExample" aria-label="Transférer à" />
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox :model-value="deleteChecked" @update:model-value="(v) => (deleteChecked = v === true)" />
              Supprimer
            </label>
          </div>
        </template>

        <!-- ─── Mode avancé ─── -->
        <template v-else>
          <div class="space-y-2">
            <Label for="filter-name">Nom du filtre</Label>
            <Input id="filter-name" v-model="draft.name" class="h-11 text-base" />
          </div>

          <fieldset class="space-y-2">
            <legend class="mb-1 text-sm font-medium">Pour les messages qui correspondent à</legend>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <input v-model="matchMode" type="radio" name="filter-match" value="all" class="size-5 shrink-0 accent-[var(--primary)]">
              Toutes les règles suivantes
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <input v-model="matchMode" type="radio" name="filter-match" value="any" class="size-5 shrink-0 accent-[var(--primary)]">
              Au moins une des règles suivantes
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <input v-model="matchMode" type="radio" name="filter-match" value="everything" class="size-5 shrink-0 accent-[var(--primary)]">
              Tous les messages
            </label>
          </fieldset>

          <div v-if="matchMode !== 'everything'" class="space-y-3">
            <div v-for="(condition, index) in draft.conditions" :key="index" class="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div class="flex items-center gap-2">
                <Select :model-value="condition.field" @update:model-value="(v) => onFieldChange(index, v as FilterField)">
                  <SelectTrigger class="h-11 flex-1 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="f in availableFields" :key="f" :value="f">{{ FIELD_LABELS[f] }}</SelectItem>
                  </SelectContent>
                </Select>
                <MailIconButton :icon="X" label="Retirer la condition" class="shrink-0" @click="removeConditionAt(index)" />
              </div>
              <Input v-if="condition.field === 'header'" v-model="condition.header" class="h-11 text-base" placeholder="Nom de l'en-tête" aria-label="Nom de l'en-tête" />
              <Select :model-value="condition.op" @update:model-value="(v) => (condition.op = v as FilterCondition['op'])">
                <SelectTrigger class="h-11 w-full text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="op in OPS_BY_FIELD[condition.field]" :key="op" :value="op">{{ OP_LABELS[op] }}</SelectItem>
                </SelectContent>
              </Select>
              <Input v-model="condition.value" class="h-11 text-base" :type="condition.field === 'date' ? 'date' : condition.field === 'size' ? 'number' : 'text'" aria-label="Valeur" />
            </div>
            <Button type="button" variant="outline" class="h-11 rounded-lg" @click="addCondition">
              <Plus class="size-4" aria-hidden="true" /> Ajouter une condition
            </Button>
          </div>

          <div class="space-y-3 border-t border-border pt-4">
            <p class="text-sm font-medium">Actions</p>
            <div v-for="(action, index) in draft.actions" :key="index" class="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div class="flex items-center gap-2">
                <Select :model-value="action.type" @update:model-value="(v) => onActionTypeChange(index, v as FilterAction['type'])">
                  <SelectTrigger class="h-11 flex-1 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="t in availableActionTypes" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
                  </SelectContent>
                </Select>
                <MailIconButton :icon="X" label="Retirer l'action" class="shrink-0" @click="removeActionAt(index)" />
              </div>

              <template v-if="action.type === 'move' || action.type === 'copy'">
                <Select :model-value="action.folder" @update:model-value="(v) => (action.folder = String(v))">
                  <SelectTrigger class="h-11 w-full text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="folder in folders" :key="folder.path" :value="folder.path">{{ folder.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </template>
              <Input v-else-if="action.type === 'add-flag'" v-model="action.flag" class="h-11 text-base" placeholder="Mot-clé" aria-label="Mot-clé" />
              <template v-else-if="action.type === 'redirect'">
                <Input v-model="action.address" type="email" class="h-11 text-base" :placeholder="addressExample" aria-label="Adresse de redirection" />
                <label class="flex min-h-11 cursor-pointer items-center gap-3">
                  <Checkbox :model-value="action.keepCopy" @update:model-value="(v) => (action.keepCopy = v === true)" />
                  Garder une copie
                </label>
              </template>
              <Textarea v-else-if="action.type === 'reject'" v-model="action.message" maxlength="500" class="text-base" placeholder="Message de rejet" aria-label="Message de rejet" />
              <template v-else-if="action.type === 'add-header'">
                <Input v-model="action.name" class="h-11 text-base" placeholder="Nom de l'en-tête" aria-label="Nom de l'en-tête" />
                <Input v-model="action.value" class="h-11 text-base" placeholder="Valeur" aria-label="Valeur de l'en-tête" />
              </template>
              <template v-else-if="action.type === 'notify'">
                <Input v-model="action.address" type="email" class="h-11 text-base" :placeholder="addressExample" aria-label="Adresse à avertir" />
                <Textarea v-model="action.message" class="text-base" placeholder="Message" aria-label="Message d'avertissement" />
              </template>
            </div>
            <Button type="button" variant="outline" class="h-11 rounded-lg" @click="addAction">
              <Plus class="size-4" aria-hidden="true" /> Ajouter une action
            </Button>
          </div>
        </template>

        <label class="flex min-h-11 cursor-pointer items-center gap-3 border-t border-border pt-4">
          <Checkbox :model-value="applyToExisting" @update:model-value="(v) => (applyToExisting = v === true)" />
          Appliquer aussi aux messages existants
        </label>
      </div>

      <DialogFooter class="gap-2 border-t border-border px-6 py-4 sm:justify-end">
        <Button type="button" variant="outline" class="h-11 rounded-lg px-6" @click="close">Annuler</Button>
        <Button type="button" class="h-11 rounded-lg px-6" :disabled="saving" @click="save">
          {{ saving ? 'Enregistrement…' : (isEditing ? 'Enregistrer' : 'Créer le filtre') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <FiltersConfirmIdentityDialog ref="confirmDialog" />
</template>
