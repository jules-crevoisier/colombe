<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Archive, EllipsisVertical, FileText, Folder as FolderIcon, FolderPlus, Inbox, Pencil, Send, ShieldAlert, Trash2 } from '@lucide/vue'
import type { Component } from 'vue'
import type { Folder, SpecialUse } from '#shared/types/mail'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ navigate: [] }>()

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
    toast(`${n} message${n > 1 ? 's' : ''} déplacé${n > 1 ? 's' : ''} vers « ${folder.name} »`)
    await mail.loadFolders()
    mail.notifyChange(payload.folder)
  }
  catch (err) {
    toast.error(errorText(err, 'Le déplacement a échoué.'))
  }
}

// ─── Gestion des dossiers personnels ───
const dialog = ref<{ mode: 'create' | 'rename'; folder?: Folder } | null>(null)
const folderName = ref('')
const nameError = ref('')
const saving = ref(false)
const toDelete = ref<Folder | null>(null)

function openCreate() {
  dialog.value = { mode: 'create' }
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
    nameError.value = 'Saisissez un nom.'
    return
  }
  saving.value = true
  nameError.value = ''
  try {
    if (d.mode === 'create') {
      const created = await api.createFolder(name)
      toast(`Dossier « ${created.name} » créé`)
    }
    else if (d.folder) {
      const { path } = await api.renameFolder(d.folder.path, name)
      toast(`Dossier renommé en « ${name} »`)
      if (current.value === d.folder.path) await navigateTo(`/mail/${encodeURIComponent(path)}`)
    }
    dialog.value = null
    await mail.loadFolders()
  }
  catch (err) {
    nameError.value = errorText(err, 'Opération impossible.')
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
    toast(`Dossier « ${folder.name} » supprimé${folder.total ? ' — ses messages sont dans la Corbeille' : ''}`)
    if (current.value === folder.path) await navigateTo('/mail/INBOX')
    await mail.loadFolders()
  }
  catch (err) {
    toast.error(errorText(err, 'Suppression impossible.'))
  }
  finally {
    toDelete.value = null
  }
}
</script>

<template>
  <nav aria-label="Dossiers" class="flex h-full flex-col gap-3">
    <Tooltip :disabled="!props.collapsed">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex h-14 shrink-0 items-center gap-3 rounded-2xl bg-compose px-4 text-sm font-medium text-compose-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          :class="props.collapsed ? 'w-14 justify-center px-0' : 'w-fit pr-6'"
          :aria-label="props.collapsed ? 'Nouveau message' : undefined"
          @click="newMessage"
        >
          <Pencil class="size-5" aria-hidden="true" />
          <span v-if="!props.collapsed">Nouveau message</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Nouveau message</TooltipContent>
    </Tooltip>

    <ul class="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1 pb-2">
      <template v-if="!mail.loaded && mail.loading">
        <li v-for="n in 6" :key="n" class="px-3 py-2">
          <Skeleton class="h-6 w-full rounded-full" />
        </li>
      </template>
      <li
        v-for="folder in mail.folders"
        :key="folder.path"
        class="group relative"
        @dragover="onDragOver(folder, $event)"
        @dragleave="dropTarget = dropTarget === folder.path ? null : dropTarget"
        @drop="onDrop(folder, $event)"
      >
        <Tooltip :disabled="!props.collapsed">
          <TooltipTrigger as-child>
            <NuxtLink
              :to="`/mail/${encodeURIComponent(folder.path)}`"
              class="relative flex h-11 items-center gap-4 rounded-full text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring lg:h-9"
              :class="[
                current === folder.path ? 'bg-nav-active font-semibold text-nav-active-foreground hover:bg-nav-active' : 'text-foreground',
                dropTarget === folder.path ? 'outline-2 outline-dashed outline-primary' : '',
                props.collapsed ? 'w-14 justify-center' : 'pl-4',
                props.collapsed ? '' : folder.specialUse ? 'pr-3' : 'pr-11',
              ]"
              :aria-current="current === folder.path ? 'page' : undefined"
              :aria-label="props.collapsed ? `${folder.name}${badge(folder) ? `, ${badge(folder)} non lus` : ''}` : undefined"
              @click="emit('navigate')"
            >
              <component :is="iconOf(folder)" class="size-5 shrink-0" aria-hidden="true" />
              <template v-if="!props.collapsed">
                <span class="flex-1 truncate" :class="{ 'font-semibold': badge(folder) > 0 }">{{ folder.name }}</span>
                <span v-if="badge(folder) > 0" class="text-xs font-semibold tabular-nums" :class="{ 'group-hover:hidden group-focus-within:hidden': !folder.specialUse }">
                  {{ badge(folder) }}<span class="sr-only">{{ folder.specialUse === 'drafts' ? ' brouillons' : ' non lus' }}</span>
                </span>
              </template>
              <span v-else-if="badge(folder) > 0" class="absolute top-1 right-1.5 size-2 rounded-full bg-primary" aria-hidden="true" />
            </NuxtLink>
          </TooltipTrigger>
          <TooltipContent side="right">{{ folder.name }}</TooltipContent>
        </Tooltip>

        <DropdownMenu v-if="!folder.specialUse && !props.collapsed">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="absolute top-0 right-0 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 focus-visible:opacity-100 lg:size-9 lg:opacity-0 lg:group-hover:opacity-100"
              :aria-label="`Actions pour le dossier ${folder.name}`"
            >
              <EllipsisVertical class="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem @select="openRename(folder)">
              <Pencil class="size-4" aria-hidden="true" /> Renommer
            </DropdownMenuItem>
            <DropdownMenuItem class="text-destructive focus:text-destructive" @select="toDelete = folder">
              <Trash2 class="size-4" aria-hidden="true" /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
      <li v-if="mail.error" class="px-4 py-2 text-sm text-destructive">
        Impossible de charger les dossiers.
        <button type="button" class="underline" @click="mail.loadFolders()">Réessayer</button>
      </li>
    </ul>

    <button
      v-if="!props.collapsed && mail.loaded"
      type="button"
      class="flex h-11 w-fit items-center gap-3 rounded-full px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground lg:h-9"
      @click="openCreate"
    >
      <FolderPlus class="size-5" aria-hidden="true" /> Nouveau dossier
    </button>

    <Dialog :open="dialog !== null" @update:open="(v: boolean) => { if (!v) dialog = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ dialog?.mode === 'rename' ? 'Renommer le dossier' : 'Nouveau dossier' }}</DialogTitle>
          <DialogDescription>{{ dialog?.mode === 'rename' ? `Nouveau nom pour « ${dialog.folder?.name} »` : 'Le dossier est créé à la racine de votre messagerie.' }}</DialogDescription>
        </DialogHeader>
        <form class="flex flex-col gap-3" @submit.prevent="submitFolder">
          <Label for="folder-name">Nom du dossier</Label>
          <Input id="folder-name" v-model="folderName" maxlength="100" autocomplete="off" class="h-11 text-base" :aria-invalid="!!nameError || undefined" aria-describedby="folder-name-error" />
          <p id="folder-name-error" class="min-h-5 text-sm text-destructive" role="alert">{{ nameError }}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" class="h-11 rounded-full px-5" @click="dialog = null">Annuler</Button>
            <Button type="submit" class="h-11 rounded-full px-5" :disabled="saving">{{ dialog?.mode === 'rename' ? 'Renommer' : 'Créer' }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="toDelete !== null" @update:open="(v: boolean) => { if (!v) toDelete = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {{ toDelete?.name }} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            {{ toDelete?.total ? `Ses ${toDelete.total} message(s) seront placés dans la Corbeille.` : 'Ce dossier est vide.' }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-full">Annuler</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-full bg-destructive text-white hover:bg-destructive/90" @click="confirmDelete">Supprimer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </nav>
</template>
