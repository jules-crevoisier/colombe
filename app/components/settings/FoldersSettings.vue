<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { Folder, SpecialFolders } from '#shared/types/mail'

const api = useSettingsApi()
const prefs = usePrefsStore()

const folders = ref<Folder[]>([])
const sizes = ref<Record<string, number>>({})
const loading = ref(true)
const togglingPath = ref<string | null>(null)

const SPECIAL_FIELDS: { key: keyof SpecialFolders; label: string }[] = [
  { key: 'sent', label: 'Dossier des messages envoyés' },
  { key: 'drafts', label: 'Brouillons' },
  { key: 'trash', label: 'Corbeille' },
  { key: 'junk', label: 'Spam' },
  { key: 'archive', label: 'Archives' },
]

function depth(path: string, delimiter: string): number {
  return delimiter ? path.split(delimiter).length - 1 : 0
}

function formatSize(bytes: number | undefined): string {
  if (bytes == null) return '…'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

async function load() {
  loading.value = true
  try {
    folders.value = await api.allFolders()
    await Promise.all(folders.value.map(async (folder) => {
      try {
        const size = await api.folderSize(folder.path)
        sizes.value[folder.path] = size.bytes
      }
      catch {
        // Une taille indisponible n'empêche pas d'afficher le reste de la liste.
      }
    }))
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible de charger les dossiers.'))
  }
  finally {
    loading.value = false
  }
}

async function toggleSubscribed(folder: Folder, subscribed: boolean) {
  togglingPath.value = folder.path
  const previous = folder.subscribed
  folder.subscribed = subscribed
  try {
    await api.subscribeFolder(folder.path, subscribed)
  }
  catch (err) {
    folder.subscribed = previous
    toast.error(errorText(err, 'Impossible de modifier cet abonnement.'))
  }
  finally {
    togglingPath.value = null
  }
}

function specialFolderValue(key: keyof SpecialFolders): string {
  return prefs.prefs.specialFolders[key] || '__auto__'
}

async function setSpecialFolder(key: keyof SpecialFolders, value: string) {
  await prefs.save({
    specialFolders: {
      ...prefs.prefs.specialFolders,
      [key]: value === '__auto__' ? '' : value,
    },
  })
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <div v-if="loading" class="space-y-3">
      <Skeleton class="h-11 w-full" />
      <Skeleton class="h-11 w-full" />
      <Skeleton class="h-11 w-full" />
    </div>

    <template v-else>
      <!-- Tableau ARIA : une ligne par dossier, nommée par son contenu (lecteurs d'écran). -->
      <div role="table" aria-label="Tous les dossiers" class="flex flex-col gap-1">
        <div role="row" class="flex items-center gap-3 px-2 py-1 text-xs font-medium text-muted-foreground">
          <span role="columnheader" class="flex-1">Dossier</span>
          <span role="columnheader" class="w-16 text-right">Taille</span>
          <span role="columnheader" class="w-24 text-right">Afficher</span>
        </div>
        <div
          v-for="folder in folders"
          :key="folder.path"
          role="row"
          class="flex min-h-11 items-center gap-3 rounded-lg border border-border px-2 py-1"
        >
          <span role="cell" class="flex-1 truncate text-sm" :style="{ paddingLeft: `${depth(folder.path, folder.delimiter) * 1.25}rem` }">
            {{ folder.name }}
          </span>
          <span role="cell" class="w-16 shrink-0 text-right text-xs text-muted-foreground">{{ formatSize(sizes[folder.path]) }}</span>
          <span role="cell" class="flex w-24 shrink-0 justify-end">
            <Switch
              :model-value="folder.subscribed"
              :disabled="togglingPath === folder.path"
              :aria-label="`Afficher ${folder.name}`"
              @update:model-value="(v: boolean) => toggleSubscribed(folder, v)"
            />
          </span>
        </div>
      </div>

      <div class="border-t border-border pt-8">
        <h3 class="mb-4 text-lg font-semibold">Dossiers spéciaux</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <div v-for="field in SPECIAL_FIELDS" :key="field.key" class="space-y-2">
            <Label :for="`special-folder-${field.key}`" class="text-sm font-medium">{{ field.label }}</Label>
            <Select :model-value="specialFolderValue(field.key)" @update:model-value="(v) => setSpecialFolder(field.key, String(v))">
              <SelectTrigger :id="`special-folder-${field.key}`" class="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Détection automatique</SelectItem>
                <SelectItem v-for="folder in folders" :key="folder.path" :value="folder.path">
                  {{ folder.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
