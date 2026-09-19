<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useDebounceFn } from '@vueuse/core'
import { Pencil, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { Contact, ContactInput } from '#shared/types/mail'
import { validateEmailAddress } from '~/utils/compose'

const session = useUserSession()
const { t } = useI18n()

const contacts = ref<Contact[]>([])
const loading = ref(false)
const searchQuery = ref('')
const adding = ref(false)
const addName = ref('')
const addEmail = ref('')
const addError = ref('')
const editingId = ref<number | null>(null)
const editingName = ref('')
const deleteDialog = ref(false)
const deletingId = ref<number | null>(null)

async function loadContacts(q: string) {
  loading.value = true
  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'GET'; query: Record<string, string | number | undefined> }
    ) => Promise<Contact[]>
    contacts.value = await fetcher('/api/contacts', {
      method: 'GET',
      query: { q, limit: 50 },
    })
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
  }
  finally {
    loading.value = false
  }
}

const debouncedLoad = useDebounceFn((q: string) => {
  void loadContacts(q)
}, 250)

watch(searchQuery, (q) => {
  debouncedLoad(q.trim())
})

async function addContact() {
  addError.value = ''
  if (!addName.value.trim()) {
    addError.value = t('settings.contacts.form.nameRequired')
    return
  }
  if (!validateEmailAddress(addEmail.value)) {
    addError.value = t('settings.contacts.form.emailInvalid')
    return
  }

  adding.value = true
  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'POST'; body: ContactInput }
    ) => Promise<Contact>
    const newContact = await fetcher('/api/contacts', {
      method: 'POST',
      body: { name: addName.value, email: addEmail.value },
    })
    contacts.value = [newContact, ...contacts.value]
    addName.value = ''
    addEmail.value = ''
    toast.success(t('settings.contacts.added'))
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
    else {
      addError.value =
        errorText(err, t('settings.contacts.addError'))
    }
  }
  finally {
    adding.value = false
  }
}

async function saveRename(id: number) {
  if (!editingName.value.trim()) {
    editingId.value = null
    return
  }

  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'PATCH'; body: { name: string } }
    ) => Promise<Contact>
    const updated = await fetcher(`/api/contacts/${id}`, {
      method: 'PATCH',
      body: { name: editingName.value },
    })
    const idx = contacts.value.findIndex(c => c.id === id)
    if (idx >= 0) {
      contacts.value[idx] = updated
    }
    editingId.value = null
    toast.success(t('settings.contacts.renamed'))
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
  }
}

async function deleteContact() {
  if (deletingId.value === null) return

  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'DELETE' }
    ) => Promise<null>
    await fetcher(`/api/contacts/${deletingId.value}`, { method: 'DELETE' })
    contacts.value = contacts.value.filter(c => c.id !== deletingId.value)
    deleteDialog.value = false
    deletingId.value = null
    toast.success(t('settings.contacts.deleted'))
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
  }
}

function startEdit(id: number, name: string) {
  editingId.value = id
  editingName.value = name
}

function cancelEdit() {
  editingId.value = null
  editingName.value = ''
}

onMounted(() => {
  void loadContacts('')
})
</script>

<template>
  <div class="space-y-6">
    <!-- Add contact form -->
    <div class="space-y-3 rounded-lg border border-border p-4">
      <h3 class="font-heading text-lg font-medium">{{ t('settings.contacts.addTitle') }}</h3>
      <div class="space-y-3">
        <div class="space-y-2">
          <Label for="contact-name" class="text-sm font-medium">{{ t('settings.contacts.form.name') }}</Label>
          <Input
            id="contact-name"
            v-model="addName"
            type="text"
            :placeholder="t('settings.contacts.form.namePlaceholder')"
            class="text-base"
          />
        </div>
        <div class="space-y-2">
          <Label for="contact-email" class="text-sm font-medium">{{ t('settings.contacts.form.email') }}</Label>
          <Input
            id="contact-email"
            v-model="addEmail"
            type="email"
            :placeholder="t('settings.contacts.form.emailPlaceholder')"
            class="text-base"
          />
        </div>
        <p v-if="addError" role="alert" class="text-sm font-medium text-destructive">
          {{ addError }}
        </p>
      </div>
      <Button
        :disabled="adding || !addName.trim() || !addEmail.trim()"
        @click="addContact"
      >
        {{ adding ? t('settings.contacts.adding') : t('common.add') }}
      </Button>
    </div>

    <!-- Search -->
    <div class="space-y-3">
      <Label for="contact-search" class="text-sm font-medium">{{ t('common.search') }}</Label>
      <Input
        id="contact-search"
        v-model="searchQuery"
        type="search"
        :placeholder="t('settings.contacts.searchPlaceholder')"
        class="text-base"
      />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-2">
      <Skeleton class="h-16 w-full" />
      <Skeleton class="h-16 w-full" />
      <Skeleton class="h-16 w-full" />
    </div>

    <!-- Empty state -->
    <div v-else-if="contacts.length === 0" class="rounded-lg border border-border bg-surface-panel p-8 text-center">
      <p class="text-sm text-muted-foreground">
        {{ searchQuery ? t('settings.contacts.emptySearch') : t('settings.contacts.emptyNone') }}
      </p>
    </div>

    <!-- Contacts list -->
    <div v-else class="space-y-2">
      <div v-for="contact of contacts" :key="contact.id" class="flex items-center gap-3 rounded-lg border border-border p-4">
        <!-- Avatar -->
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          :class="getAvatarTone(contact.email)"
        >
          {{ getInitials(contact.name) }}
        </div>

        <!-- Info (editable name, email, badge, times contacted) -->
        <div class="flex-1 min-w-0 space-y-1">
          <div v-if="editingId === contact.id" class="flex gap-2 items-center">
            <input
              v-model="editingName"
              type="text"
              class="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              @keydown.enter="saveRename(contact.id)"
              @keydown.escape="cancelEdit"
              @blur="if (editingId === contact.id && editingName.trim()) saveRename(contact.id); else cancelEdit()"
            />
          </div>
          <div v-else class="text-sm font-medium truncate">
            {{ contact.name }}
          </div>
          <div class="text-xs text-muted-foreground truncate">
            {{ contact.email }}
          </div>
          <div class="flex gap-2 items-center pt-1">
            <Badge v-if="contact.manual" variant="secondary" class="text-xs">
              {{ t('settings.contacts.manualBadge') }}
            </Badge>
            <Badge v-else variant="outline" class="text-xs">
              {{ t('settings.contacts.autoBadge') }}
            </Badge>
            <span v-if="contact.timesContacted > 0" class="text-xs text-muted-foreground">
              {{ t('settings.contacts.timesContacted', { n: contact.timesContacted }, contact.timesContacted) }}
            </span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-1 shrink-0">
          <MailIconButton
            v-if="!editingId || editingId !== contact.id"
            :icon="Pencil"
            :label="t('common.rename')"
            @click="startEdit(contact.id, contact.name)"
          />
          <MailIconButton
            :icon="Trash2"
            :label="t('common.delete')"
            @click="() => { deletingId = contact.id; deleteDialog = true }"
          />
        </div>
      </div>
    </div>

    <!-- Delete confirmation dialog -->
    <AlertDialog v-model:open="deleteDialog">
      <AlertDialogContent class="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('settings.contacts.deleteConfirmTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.contacts.deleteConfirmDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="sm:justify-end">
          <AlertDialogCancel>
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            @click="deleteContact"
          >
            {{ t('common.delete') }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
