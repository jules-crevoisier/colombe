<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Archive, BookUser, ChevronDown, ChevronRight, EllipsisVertical, FileText, Folder as FolderIcon, FolderPlus, HardDrive, Inbox, PenLine, Pencil, Send, ShieldAlert, Trash2 } from '@lucide/vue'
import type { Component } from 'vue'
import type { Folder, SpecialUse } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()
const mail = useMailStore()
const compose = useComposeStore()
const api = useMailApi()
const route = useRoute()

const ICONS: Record<SpecialUse, Component> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  trash: Trash2,
  junk: ShieldAlert,
  archive: Archive,
}

const current = computed(() => (typeof route.params.folder === 'string' ? route.params.folder : ''))

function iconOf(folder: Folder): Component {
  return folder.specialUse ? ICONS[folder.specialUse] : FolderIcon
}

// Brouillons : le total est plus parlant ; Envoyés et Corbeille : pas de compteur.
function badge(folder: Folder): number {
  if (folder.specialUse === 'drafts') return folder.total
  if (folder.specialUse === 'sent' || folder.specialUse === 'trash') return 0
  return folder.unread
}

function newMessage() {
  void compose.openNew()
  emit('navigate')
}

// ─── Arborescence des sous-dossiers (R2.4) : dépliée par défaut ───
interface FolderRow { folder: Folder, depth: number, hasChildren: boolean }
const collapsedPaths = ref(new Set<string>())

function parentPathOf(folder: Folder): string | null {
  if (!folder.delimiter) return null
  const idx = folder.path.lastIndexOf(folder.delimiter)
  return idx > 0 ? folder.path.slice(0, idx) : null
}

function toggleCollapse(path: string) {
  const next = new Set(collapsedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsedPaths.value = next
}

const rows = computed<FolderRow[]>(() => {
  const folders = mail.folders
  const byPath = new Map(folders.map(f => [f.path, f]))
  const childrenOf = new Map<string, Folder[]>()
  for (const f of folders) {
    const parent = parentPathOf(f)
    if (parent && byPath.has(parent)) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), f])
    }
  }
  const depthCache = new Map<string, number>()
  function depthOf(f: Folder): number {
    const cached = depthCache.get(f.path)
    if (cached !== undefined) return cached
    const parentPath = parentPathOf(f)
    const parent = parentPath ? byPath.get(parentPath) : undefined
    const d = parent ? depthOf(parent) + 1 : 0
    depthCache.set(f.path, d)
    return d
  }
  const result: FolderRow[] = []
  function visit(f: Folder) {
    const children = childrenOf.get(f.path) ?? []
    result.push({ folder: f, depth: depthOf(f), hasChildren: children.length > 0 })
    if (collapsedPaths.value.has(f.path)) return
    for (const child of children) visit(child)
  }
  const roots = folders.filter((f) => {
    const parent = parentPathOf(f)
    return !parent || !byPath.has(parent)
  })
  for (const root of roots) visit(root)
  return result
})

/** Dossiers pouvant accueillir un déplacement : ni soi-même, ni un de ses descendants. */
function moveTargetsFor(folder: Folder): Folder[] {
  const prefix = folder.delimiter ? `${folder.path}${folder.delimiter}` : null
  return mail.folders.filter(f => f.path !== folder.path && !(prefix && f.path.startsWith(prefix)))
}

// ─── Glisser-déposer de messages sur un dossier ───
const dropTarget = ref<string | null>(null)

function onDragOver(folder: Folder, e: DragEvent) {
  if (!e.dataTransfer?.types.includes(DRAG_MIME) || folder.specialUse === 'drafts') return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  dropTarget.value = folder.path
}

async function onDrop(folder: Folder, e: DragEvent) {
  dropTarget.value = null
  const payload = parseDragPayload(e.dataTransfer?.getData(DRAG_MIME) ?? '')
  if (!payload || payload.folder === folder.path || folder.specialUse === 'drafts') return
  e.preventDefault()
  try {
    await api.move(payload.folder, payload.uids, folder.path)
    const n = payload.uids.length
    toast(t('folderNav.toast.moved', { n, folder: folderLabel(folder) }, n))
    await mail.loadFolders()
    mail.notifyChange(payload.folder)
  }
  catch (err) {
    toast.error(errorText(err, t('folderNav.toast.moveDropFailed')))
  }
}

// ─── Gestion des dossiers personnels ───
const dialog = ref<{ mode: 'create' | 'rename', folder?: Folder, parent?: string } | null>(null)
const folderName = ref('')
const nameError = ref('')
const saving = ref(false)
const toDelete = ref<Folder | null>(null)
const toEmpty = ref<Folder | null>(null)

function openCreate(parent?: string) {
  dialog.value = { mode: 'create', parent }
  folderName.value = ''
  nameError.value = ''
}
function openRename(folder: Folder) {
  dialog.value = { mode: 'rename', folder }
  folderName.value = folder.name
  nameError.value = ''
}

async function submitFolder() {
  const d = dialog.value
  const name = folderName.value.trim()
  if (!d || !name) {
    nameError.value = t('folderNav.dialog.nameRequired')
    return
  }
  saving.value = true
  nameError.value = ''
  try {
    if (d.mode === 'create') {
      const created = await api.createFolder(name, d.parent)
      toast(t('folderNav.toast.created', { name: folderLabel(created) }))
    }
    else if (d.folder) {
      const { path } = await api.renameFolder(d.folder.path, name)
      toast(t('folderNav.toast.renamed', { name }))
      if (current.value === d.folder.path) await navigateTo(`/mail/${encodeURIComponent(path)}`)
    }
    dialog.value = null
    await mail.loadFolders()
  }
  catch (err) {
    nameError.value = errorText(err, t('folderNav.dialog.saveFailed'))
  }
  finally {
    saving.value = false
  }
}

async function confirmDelete() {
  const folder = toDelete.value
  if (!folder) return
  try {
    await api.deleteFolder(folder.path)
    toast(folder.total
      ? t('folderNav.toast.deletedWithMessages', { name: folderLabel(folder), trash: t('folders.special.trash') })
      : t('folderNav.toast.deleted', { name: folderLabel(folder) }))
    if (current.value === folder.path) await navigateTo('/mail/INBOX')
    await mail.loadFolders()
    void mail.loadQuota(true)
  }
  catch (err) {
    toast.error(errorText(err, t('folderNav.dialog.deleteFailed')))
  }
  finally {
    toDelete.value = null
  }
}

async function confirmEmpty() {
  const folder = toEmpty.value
  toEmpty.value = null
  if (!folder) return
  try {
    await api.emptyFolder(folder.path)
    toast(t('folderNav.toast.emptied', { name: folderLabel(folder) }))
    mail.notifyChange(folder.path)
    await mail.loadFolders()
    void mail.loadQuota(true)
  }
  catch (err) {
    toast.error(errorText(err, t('folderNav.dialog.emptyFailed')))
  }
}

// ─── Déplacer vers… ───
const ROOT_VALUE = '__root__'
const moveDialog = ref<Folder | null>(null)
const moveTarget = ref(ROOT_VALUE)
const moveSaving = ref(false)

function openMove(folder: Folder) {
  moveDialog.value = folder
  moveTarget.value = ROOT_VALUE
}

async function submitMove() {
  const folder = moveDialog.value
  if (!folder) return
  moveSaving.value = true
  try {
    await api.moveFolder(folder.path, moveTarget.value === ROOT_VALUE ? null : moveTarget.value)
    toast(t('folderNav.toast.movedTo', { name: folderLabel(folder) }))
    moveDialog.value = null
    await mail.loadFolders()
  }
  catch (err) {
    toast.error(errorText(err, t('folderNav.dialog.moveFailed')))
  }
  finally {
    moveSaving.value = false
  }
}

// ─── Jauge de quota (R2.4) : une fois par page (store, TTL 60 s), voir confirmDelete/confirmEmpty
// pour le rafraîchissement forcé sur changement de dossiers. ───
const quota = computed(() => mail.quota)
onMounted(() => {
  void mail.loadQuota()
})
const quotaRatio = computed(() => {
  if (!quota.value?.limitBytes) return 0
  return Math.min(1, quota.value.usedBytes / quota.value.limitBytes)
})
</script>

<template>
  <nav :aria-label="t('folderNav.ariaLabel')" class="flex h-full min-h-0 flex-col gap-4">
    <!-- « Nouveau message » : une lettre à l'encre, coin replié orange (le bec). -->
    <Tooltip :disabled="!props.collapsed">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="fold-corner group/compose flex h-12 shrink-0 items-center gap-3 rounded-lg bg-compose text-[15px] font-semibold text-compose-foreground transition-[filter,transform] hover:brightness-[1.12] active:translate-y-px"
          :class="props.collapsed ? 'w-12 justify-center self-center' : 'w-full px-4'"
          :aria-label="props.collapsed ? t('folderNav.compose') : undefined"
          @click="newMessage"
        >
          <PenLine class="size-[18px] shrink-0" aria-hidden="true" />
          <span v-if="!props.collapsed">{{ t('folderNav.compose') }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{{ t('folderNav.compose') }}</TooltipContent>
    </Tooltip>

    <ul class="-mx-1 flex min-h-0 flex-col gap-px overflow-y-auto px-1 pb-2">
      <template v-if="!mail.loaded && mail.loading">
        <li v-for="n in 6" :key="n" class="px-3 py-2">
          <Skeleton class="h-5 w-full rounded-md" />
        </li>
      </template>
      <li
        v-for="row in rows"
        :key="row.folder.path"
        class="group relative"
        @dragover="onDragOver(row.folder, $event)"
        @dragleave="dropTarget = dropTarget === row.folder.path ? null : dropTarget"
        @drop="onDrop(row.folder, $event)"
      >
        <!-- Repli/dépli des sous-dossiers : à côté du lien, jamais imbriqué dans le <a> -->
        <button
          v-if="row.hasChildren && !props.collapsed"
          type="button"
          class="absolute top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:size-6"
          :style="{ left: `${row.depth * 16}px` }"
          :aria-label="collapsedPaths.has(row.folder.path) ? t('folderNav.expand', { name: folderLabel(row.folder) }) : t('folderNav.collapse', { name: folderLabel(row.folder) })"
          :aria-expanded="!collapsedPaths.has(row.folder.path)"
          @click="toggleCollapse(row.folder.path)"
        >
          <component :is="collapsedPaths.has(row.folder.path) ? ChevronRight : ChevronDown" class="size-4" aria-hidden="true" />
        </button>

        <Tooltip :disabled="!props.collapsed">
          <TooltipTrigger as-child>
            <NuxtLink
              :to="`/mail/${encodeURIComponent(row.folder.path)}`"
              class="relative flex h-11 items-center gap-3 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:h-9"
              :class="[
                current === row.folder.path
                  ? 'bg-nav-active font-semibold text-nav-active-foreground shadow-[0_0_0_1px_var(--border)] before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-sm before:bg-nav-marker'
                  : 'text-foreground/90 hover:bg-foreground/[0.05] hover:text-foreground',
                dropTarget === row.folder.path ? 'outline-2 outline-dashed outline-primary' : '',
                props.collapsed ? 'size-12 justify-center lg:size-11' : '',
                props.collapsed ? '' : row.folder.specialUse ? 'pr-3' : 'pr-11',
              ]"
              :style="props.collapsed ? undefined : { paddingLeft: `${12 + row.depth * 16 + (row.hasChildren ? 20 : 0)}px` }"
              :aria-current="current === row.folder.path ? 'page' : undefined"
              :aria-label="props.collapsed ? `${folderLabel(row.folder)}${badge(row.folder) ? t('folderNav.unreadSuffix', { n: badge(row.folder) }) : ''}` : undefined"
              @click="emit('navigate')"
            >
              <component :is="iconOf(row.folder)" class="size-[18px] shrink-0" :class="current === row.folder.path ? 'text-nav-marker' : 'text-muted-foreground'" :stroke-width="1.75" aria-hidden="true" />
              <template v-if="!props.collapsed">
                <span class="flex-1 truncate" :class="{ 'font-semibold': badge(row.folder) > 0 }">{{ folderLabel(row.folder) }}</span>
                <span v-if="badge(row.folder) > 0" class="text-xs tabular-nums" :class="[row.folder.specialUse === 'drafts' ? 'text-muted-foreground' : 'font-semibold text-foreground', { 'group-hover:hidden group-focus-within:hidden': !row.folder.specialUse }]">
                  {{ badge(row.folder) }}<span class="sr-only">{{ row.folder.specialUse === 'drafts' ? t('folderNav.srDrafts') : t('folderNav.srUnread') }}</span>
                </span>
              </template>
              <span v-else-if="badge(row.folder) > 0" class="absolute top-2 right-2 size-2 rounded-full bg-unread-dot ring-2 ring-surface-app" aria-hidden="true" />
            </NuxtLink>
          </TooltipTrigger>
          <TooltipContent side="right">{{ folderLabel(row.folder) }}</TooltipContent>
        </Tooltip>

        <DropdownMenu v-if="!row.folder.specialUse && !props.collapsed">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="absolute top-0 right-0 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=open]:opacity-100 lg:size-9 lg:opacity-0 lg:group-hover:opacity-100"
              :aria-label="t('folderNav.actionsFor', { name: folderLabel(row.folder) })"
            >
              <EllipsisVertical class="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem @select="openCreate(row.folder.path)">
              <FolderPlus class="size-4" aria-hidden="true" /> {{ t('folderNav.dialog.newSubfolderTitle') }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="openRename(row.folder)">
              <Pencil class="size-4" aria-hidden="true" /> {{ t('common.rename') }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="openMove(row.folder)">
              <FolderIcon class="size-4" aria-hidden="true" /> {{ t('folderNav.moveTo') }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="toEmpty = row.folder">
              <Trash2 class="size-4" aria-hidden="true" /> {{ t('folderNav.emptyFolder') }}
            </DropdownMenuItem>
            <DropdownMenuItem class="text-destructive focus:text-destructive" @select="toDelete = row.folder">
              <Trash2 class="size-4" aria-hidden="true" /> {{ t('common.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
      <li v-if="mail.error" class="px-4 py-2 text-sm text-destructive">
        {{ t('folderNav.loadFailed') }}
        <button type="button" class="underline" @click="mail.loadFolders()">{{ t('common.retry') }}</button>
      </li>
    </ul>

    <div class="flex flex-col gap-px border-t border-border pt-3" :class="props.collapsed ? 'items-center' : ''">
      <NuxtLink
        to="/contacts"
        class="relative flex h-11 items-center gap-3 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:h-9"
        :class="[
          route.path.startsWith('/contacts')
            ? 'bg-nav-active font-semibold text-nav-active-foreground shadow-[0_0_0_1px_var(--border)] before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-sm before:bg-nav-marker'
            : 'text-foreground/90 hover:bg-foreground/[0.05] hover:text-foreground',
          props.collapsed ? 'size-11 justify-center' : 'pl-3',
        ]"
        :aria-label="props.collapsed ? t('folderNav.contactsLink') : undefined"
        @click="emit('navigate')"
      >
        <BookUser class="size-[18px] shrink-0 text-muted-foreground" :stroke-width="1.75" aria-hidden="true" />
        <span v-if="!props.collapsed">{{ t('folderNav.contactsLink') }}</span>
      </NuxtLink>

      <button
        v-if="!props.collapsed && mail.loaded"
        type="button"
        class="flex h-11 items-center gap-3 rounded-md pl-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:h-9"
        @click="openCreate()"
      >
        <FolderPlus class="size-[18px]" :stroke-width="1.75" aria-hidden="true" /> {{ t('folderNav.newFolder') }}
      </button>
    </div>

    <!-- Jauge « Espace utilisé » (R2.4), masquée si le serveur ne fournit pas de quota -->
    <div v-if="!props.collapsed && quota?.limitBytes" class="mt-auto flex flex-col gap-2 px-3 pt-2 pb-1 text-xs text-muted-foreground">
      <div class="flex items-center gap-2">
        <HardDrive class="size-3.5 shrink-0" aria-hidden="true" />
        <span>{{ t('folderNav.quota.label') }}</span>
      </div>
      <div class="h-1 w-full overflow-hidden rounded-full bg-border" role="progressbar" :aria-label="t('folderNav.quota.label')" :aria-valuenow="Math.round(quotaRatio * 100)" aria-valuemin="0" aria-valuemax="100">
        <div class="h-full rounded-full bg-nav-marker" :style="{ width: `${Math.max(quotaRatio * 100, 1.5)}%` }" />
      </div>
      <span class="tabular-nums">{{ t('folderNav.quota.usage', { used: formatGigabytes(quota.usedBytes), limit: formatGigabytes(quota.limitBytes) }) }}</span>
    </div>

    <Dialog :open="dialog !== null" @update:open="(v: boolean) => { if (!v) dialog = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ dialog?.mode === 'rename' ? t('folderNav.dialog.renameTitle') : dialog?.parent ? t('folderNav.dialog.newSubfolderTitle') : t('folderNav.newFolder') }}</DialogTitle>
          <DialogDescription>{{ dialog?.mode === 'rename' ? t('folderNav.dialog.renameDescription', { name: dialog.folder ? folderLabel(dialog.folder) : '' }) : dialog?.parent ? t('folderNav.dialog.subfolderDescription', { name: mail.byPath(dialog.parent) ? folderLabel(mail.byPath(dialog.parent)!) : dialog.parent }) : t('folderNav.dialog.rootDescription') }}</DialogDescription>
        </DialogHeader>
        <form class="flex flex-col gap-3" @submit.prevent="submitFolder">
          <Label for="folder-name">{{ t('folderNav.dialog.nameLabel') }}</Label>
          <Input id="folder-name" v-model="folderName" maxlength="100" autocomplete="off" class="h-11 text-base" :aria-invalid="!!nameError || undefined" aria-describedby="folder-name-error" />
          <p id="folder-name-error" class="min-h-5 text-sm text-destructive" role="alert">{{ nameError }}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" class="h-11 rounded-lg px-5" @click="dialog = null">{{ t('common.cancel') }}</Button>
            <Button type="submit" class="h-11 rounded-lg px-5" :disabled="saving">{{ dialog?.mode === 'rename' ? t('common.rename') : t('common.create') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Déplacer vers… -->
    <Dialog :open="moveDialog !== null" @update:open="(v: boolean) => { if (!v) moveDialog = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('folderNav.dialog.moveTitle', { name: moveDialog ? folderLabel(moveDialog) : '' }) }}</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <Label for="move-target">{{ t('folderNav.dialog.destinationLabel') }}</Label>
          <Select :model-value="moveTarget" @update:model-value="(v) => { moveTarget = String(v) }">
            <SelectTrigger id="move-target" class="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ROOT_VALUE">{{ t('folderNav.dialog.rootOption') }}</SelectItem>
              <SelectItem v-for="f in moveDialog ? moveTargetsFor(moveDialog) : []" :key="f.path" :value="f.path">{{ folderLabel(f) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" class="h-11 rounded-lg px-5" @click="moveDialog = null">{{ t('common.cancel') }}</Button>
          <Button type="button" class="h-11 rounded-lg px-5" :disabled="moveSaving" @click="submitMove">{{ t('common.move') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="toDelete !== null" @update:open="(v: boolean) => { if (!v) toDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('folderNav.dialog.deleteTitle', { name: toDelete ? folderLabel(toDelete) : '' }) }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ toDelete?.total ? t('folderNav.dialog.deleteWithMessages', { n: toDelete.total, trash: t('folders.special.trash') }, toDelete.total) : t('folderNav.dialog.deleteEmpty') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-lg">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDelete">{{ t('common.delete') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Vider le dossier -->
    <AlertDialog :open="toEmpty !== null" @update:open="(v: boolean) => { if (!v) toEmpty = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('folderNav.dialog.emptyTitle', { name: toEmpty ? folderLabel(toEmpty) : '' }) }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('folderNav.dialog.emptyDescription') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-lg">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmEmpty">{{ t('folderNav.dialog.emptyConfirm') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </nav>
</template>
