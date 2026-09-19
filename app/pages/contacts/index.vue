<script setup lang="ts">
import { toast } from 'vue-sonner'
import { watchDebounced } from '@vueuse/core'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { FileDown, FolderOpen, Plus, Search, Users } from '@lucide/vue'
import type { Contact, ContactDetail, ContactDetailInput, ContactGroup } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'

definePageMeta({ layout: 'mail' })

const { t } = useI18n()
const api = useContactsApi()
const { config: siteConfig } = useSiteConfig()
const activeTab = ref<'contacts' | 'directory'>('contacts')

const contacts = ref<Contact[]>([])
const groups = ref<ContactGroup[]>([])
const loading = ref(true)
const failed = ref(false)
const search = ref('')
/** 'all' | 'collected' | un id de groupe. */
const view = ref<'all' | 'collected' | number>('all')
const selectedId = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

async function loadGroups() {
  try {
    groups.value = await api.groups()
  }
  catch {
    // Les groupes sont secondaires : la liste des contacts reste utilisable sans eux.
  }
}

async function loadContacts() {
  loading.value = true
  failed.value = false
  try {
    contacts.value = await api.list({
      q: search.value.trim() || undefined,
      limit: 200,
      scope: view.value === 'collected' ? 'collected' : 'all',
      groupId: typeof view.value === 'number' ? view.value : undefined,
    })
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

watchDebounced(search, () => void loadContacts(), { debounce: 250 })
watch(view, () => void loadContacts())

onMounted(() => {
  void loadGroups()
  void loadContacts()
})

function selectContact(id: number) {
  selectedId.value = id
}
function closeDetail() {
  selectedId.value = null
}
function onDeleted() {
  selectedId.value = null
  void loadContacts()
}
function onSaved(updated: ContactDetail) {
  const idx = contacts.value.findIndex(c => c.id === updated.id)
  const existing = contacts.value[idx]
  if (existing) contacts.value[idx] = { ...existing, name: updated.name, email: updated.email }
  else void loadContacts()
}

// ─── Nouveau contact ───
const createOpen = ref(false)
function emptyContactInput(): ContactDetailInput {
  return {
    firstName: '',
    lastName: '',
    displayName: '',
    emails: [{ label: 'other', address: '' }],
    phones: [],
    organization: '',
    jobTitle: '',
    address: null,
    birthday: null,
    notes: '',
  }
}
const createForm = ref<ContactDetailInput>(emptyContactInput())
function openCreate() {
  createForm.value = emptyContactInput()
  createOpen.value = true
}
async function submitCreate(input: ContactDetailInput) {
  try {
    const created = await api.create(input)
    createOpen.value = false
    toast.success(t('contacts.toast.created'))
    await loadContacts()
    selectedId.value = created.id
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.errors.createFailed')))
  }
}

// ─── Nouveau groupe ───
const groupDialogOpen = ref(false)
const newGroupName = ref('')
const groupSaving = ref(false)
function openCreateGroup() {
  newGroupName.value = ''
  groupDialogOpen.value = true
}
async function submitCreateGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  groupSaving.value = true
  try {
    await api.createGroup(name)
    groupDialogOpen.value = false
    toast.success(t('contacts.toast.groupCreated'))
    await loadGroups()
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.errors.groupCreateFailed')))
  }
  finally {
    groupSaving.value = false
  }
}

// ─── Importer / Exporter ───
async function importFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  const file = files?.[0]
  if (!file) return
  try {
    const result = await api.importFile(file, file.name)
    const imported = t('contacts.toast.imported', result.imported)
    const skipped = result.skipped ? t('contacts.toast.importedSkipped', result.skipped) : ''
    toast(imported + skipped)
    await loadContacts()
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.errors.importFailed')))
  }
  if (fileInput.value) fileInput.value.value = ''
}

useHead({ title: computed(() => t('contacts.pageTitle')) })
</script>

<template>
  <TabsRoot v-model="activeTab" class="flex h-full min-h-0 flex-col">
    <!-- Onglets : masqués sans annuaire LDAP configuré, l'interface reste identique
         à avant (docs/dev — annuaire de l'établissement). -->
    <TabsList v-if="siteConfig.features.directory" :aria-label="t('contacts.pageTitle')" class="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 pt-2 [scrollbar-width:none] sm:px-4">
      <TabsTrigger
        value="contacts"
        class="relative -mb-px h-11 flex-none border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=active]:border-nav-marker data-[state=active]:font-semibold data-[state=active]:text-foreground"
      >
        {{ t('contacts.myContacts') }}
      </TabsTrigger>
      <TabsTrigger
        value="directory"
        class="relative -mb-px h-11 flex-none border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=active]:border-nav-marker data-[state=active]:font-semibold data-[state=active]:text-foreground"
      >
        {{ t('contacts.directory.title') }}
      </TabsTrigger>
    </TabsList>

    <TabsContent value="directory" class="min-h-0 flex-1 outline-none">
      <ContactsDirectoryPanel @added="loadContacts" />
    </TabsContent>

  <TabsContent value="contacts" class="flex min-h-0 flex-1 flex-col outline-none lg:flex-row">
    <!-- Groupes (à gauche sur bureau, bandeau en haut sur mobile) -->
    <nav :aria-label="t('contacts.groupsNavLabel')" class="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 [scrollbar-width:none] lg:w-56 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:p-3">
      <button
        type="button"
        class="flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:h-9"
        :class="view === 'all' ? 'bg-accent font-semibold text-foreground' : ''"
        @click="view = 'all'"
      >
        <FolderOpen class="size-4 shrink-0" aria-hidden="true" /> <span>{{ t('contacts.allContacts') }}</span>
      </button>
      <button
        type="button"
        class="flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:h-9"
        :class="view === 'collected' ? 'bg-accent font-semibold text-foreground' : ''"
        @click="view = 'collected'"
      >
        <Users class="size-4 shrink-0" aria-hidden="true" /> <span>{{ t('contacts.collectedAddresses') }}</span>
      </button>
      <div class="my-1 hidden border-t border-border lg:block" />
      <button
        v-for="g in groups"
        :key="g.id"
        type="button"
        class="flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:h-9"
        :class="view === g.id ? 'bg-accent font-semibold text-foreground' : ''"
        @click="view = g.id"
      >
        <span class="truncate">{{ g.name }}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{{ g.memberCount }}</span>
      </button>
      <button type="button" class="flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-accent lg:h-9" @click="openCreateGroup">
        <Plus class="size-4 shrink-0" aria-hidden="true" /> {{ t('contacts.newGroup') }}
      </button>
    </nav>

    <!-- Liste -->
    <div class="min-w-0 flex-1 flex-col overflow-hidden" :class="selectedId !== null ? 'hidden lg:flex' : 'flex'">
      <div class="flex shrink-0 flex-col gap-3 border-b border-border p-3">
        <div class="flex items-center justify-between gap-2">
          <h1 class="font-heading text-[26px] leading-tight font-medium tracking-[-0.015em]">{{ t('contacts.pageTitle') }}</h1>
          <div class="flex flex-wrap gap-2">
            <Button class="h-11 px-4 text-sm lg:h-10" @click="openCreate">
              <Plus class="size-4" aria-hidden="true" /> {{ t('contacts.newContact') }}
            </Button>
            <Button variant="outline" class="h-11 px-4 text-sm lg:h-10" @click="fileInput?.click()">
              {{ t('contacts.import') }}
            </Button>
            <input ref="fileInput" type="file" accept=".vcf,.csv,text/vcard,text/csv" hidden @change="importFiles">
            <Button as-child variant="outline" class="h-11 px-4 text-sm lg:h-10">
              <a :href="api.exportVcfUrl()">
                <FileDown class="size-4" aria-hidden="true" /> {{ t('contacts.exportVcf') }}
              </a>
            </Button>
          </div>
        </div>
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            v-model="search"
            type="search"
            :placeholder="t('contacts.searchPlaceholder')"
            :aria-label="t('contacts.searchPlaceholder')"
            class="h-11 pl-9 text-base"
          />
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="loading" class="flex flex-col gap-2 p-3">
          <Skeleton v-for="n in 6" :key="n" class="h-14 w-full rounded-xl" />
        </div>
        <p v-else-if="failed" role="alert" class="p-6 text-sm text-destructive">{{ t('contacts.loadFailed') }}</p>
        <div v-else-if="!contacts.length" class="flex animate-settle flex-col items-center px-6 py-14 text-center">
          <BrandDove class="mb-5 w-40" :trail="!search" />
          <p class="font-heading text-[22px] leading-snug font-medium">{{ search ? t('contacts.noOneFound') : t('contacts.empty.title') }}</p>
          <p class="mt-1 max-w-xs text-base text-muted-foreground">{{ search ? t('contacts.empty.noResultsHint') : t('contacts.empty.hint') }}</p>
        </div>
        <ul v-else aria-label="Contacts" class="flex flex-col">
          <li v-for="c in contacts" :key="c.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left hover:bg-accent"
              :class="selectedId === c.id ? 'bg-row-selected' : ''"
              @click="selectContact(c.id)"
            >
              <span class="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" :class="getAvatarTone(c.email)" aria-hidden="true">
                {{ getInitials(c.name || c.email) }}
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-sm font-medium">{{ c.name || c.email }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ c.email }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <!-- Fiche -->
    <div v-if="selectedId !== null" class="min-w-0 flex-1 border-border lg:border-l">
      <ContactsContactDetailPanel :id="selectedId" :groups="groups" @close="closeDetail" @deleted="onDeleted" @saved="onSaved" />
    </div>

    <!-- Nouveau contact -->
    <Dialog :open="createOpen" @update:open="(v: boolean) => { if (!v) createOpen = false }">
      <DialogContent class="flex max-h-[85dvh] flex-col gap-0 sm:max-w-2xl">
        <DialogHeader class="border-b px-6 py-4">
          <DialogTitle>{{ t('contacts.newContact') }}</DialogTitle>
        </DialogHeader>
        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <ContactsContactForm v-model="createForm" :submit-label="t('common.save')" @submit="submitCreate" @cancel="createOpen = false" />
        </div>
      </DialogContent>
    </Dialog>

    <!-- Nouveau groupe -->
    <Dialog :open="groupDialogOpen" @update:open="(v: boolean) => { if (!v) groupDialogOpen = false }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('contacts.newGroup') }}</DialogTitle>
        </DialogHeader>
        <form class="flex flex-col gap-3" @submit.prevent="submitCreateGroup">
          <Label for="group-name">{{ t('contacts.nameLabel') }}</Label>
          <Input id="group-name" v-model="newGroupName" maxlength="100" autocomplete="off" class="h-11 text-base" />
          <DialogFooter>
            <Button type="button" variant="ghost" class="h-11 rounded-lg px-5" @click="groupDialogOpen = false">{{ t('common.cancel') }}</Button>
            <Button type="submit" class="h-11 rounded-lg px-5" :disabled="groupSaving || !newGroupName.trim()">{{ t('common.save') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </TabsContent>
  </TabsRoot>
</template>
