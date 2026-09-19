<script setup lang="ts">
import { toast } from 'vue-sonner'
import { watchDebounced } from '@vueuse/core'
import { Search, Building2, Phone, UserPlus, GraduationCap } from '@lucide/vue'
import type { DirectoryEntry } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'

/**
 * Annuaire LDAP de l'établissement (GET /api/directory/search), onglet « Annuaire »
 * de la page Contacts. Toujours monté seulement quand `features.directory` est vrai
 * (voir app/pages/contacts/index.vue).
 */
const emit = defineEmits<{ added: [] }>()

const { t } = useI18n()
const directoryApi = useDirectoryApi()
const contactsApi = useContactsApi()

const search = ref('')
const results = ref<DirectoryEntry[]>([])
const loading = ref(false)
const failed = ref(false)
const searched = ref(false)
const addingEmail = ref<string | null>(null)
const addedEmails = ref(new Set<string>())

async function runSearch(q: string) {
  const query = q.trim()
  if (query.length < 3) {
    results.value = []
    failed.value = false
    searched.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    results.value = await directoryApi.search(query)
    searched.value = true
  }
  catch {
    results.value = []
    failed.value = true
    searched.value = true
  }
  finally {
    loading.value = false
  }
}

watchDebounced(search, () => void runSearch(search.value), { debounce: 250 })

async function addToContacts(entry: DirectoryEntry) {
  addingEmail.value = entry.email
  try {
    await contactsApi.quickAdd(entry.email, entry.name)
    addedEmails.value.add(entry.email)
    toast.success(t('contacts.directory.added', { name: entry.name || entry.email }))
    emit('added')
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.directory.addFailed')))
  }
  finally {
    addingEmail.value = null
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-col gap-3 border-b border-border p-3">
      <div>
        <h2 class="font-heading text-lg font-medium">{{ t('contacts.directory.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('contacts.directory.subtitle') }}</p>
      </div>
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          v-model="search"
          type="search"
          :placeholder="t('contacts.directory.searchPlaceholder')"
          :aria-label="t('contacts.directory.searchAriaLabel')"
          class="h-11 pl-9 text-base"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="flex flex-col gap-2 p-3">
        <Skeleton v-for="n in 4" :key="n" class="h-20 w-full rounded-xl" />
      </div>
      <p v-else-if="failed" role="alert" class="p-6 text-sm text-destructive">
        {{ t('contacts.directory.unavailable') }}
      </p>
      <div v-else-if="!searched" class="flex animate-settle flex-col items-center px-6 py-14 text-center">
        <Building2 class="mb-4 size-12 text-muted-foreground/60" aria-hidden="true" />
        <p class="font-heading text-[20px] leading-snug font-medium">{{ t('contacts.directory.promptTitle') }}</p>
        <p class="mt-1 max-w-xs text-base text-muted-foreground">{{ t('contacts.directory.promptHint') }}</p>
      </div>
      <div v-else-if="!results.length" class="flex animate-settle flex-col items-center px-6 py-14 text-center">
        <Building2 class="mb-4 size-12 text-muted-foreground/60" aria-hidden="true" />
        <p class="font-heading text-[20px] leading-snug font-medium">{{ t('contacts.noOneFound') }}</p>
        <p class="mt-1 max-w-xs text-base text-muted-foreground">{{ t('contacts.directory.noResultsHint') }}</p>
      </div>
      <ul v-else :aria-label="t('contacts.directory.resultsLabel')" class="flex flex-col">
        <li v-for="entry in results" :key="entry.email" class="flex items-start gap-3 border-b border-border p-3 sm:items-center">
          <span class="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" :class="getAvatarTone(entry.email)" aria-hidden="true">
            {{ getInitials(entry.name || entry.email) }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="truncate text-sm font-medium">{{ entry.name }}</span>
              <span v-if="entry.affiliation" class="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-secondary-foreground uppercase">{{ entry.affiliation }}</span>
            </div>
            <p class="truncate text-sm text-muted-foreground">{{ entry.email }}</p>
            <p v-if="entry.title || entry.department" class="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <GraduationCap class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ [entry.title, entry.department].filter(Boolean).join(' · ') }}</span>
            </p>
            <p v-if="entry.phone" class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Phone class="size-3.5 shrink-0" aria-hidden="true" />
              {{ entry.phone }}
            </p>
          </div>
          <Button
            variant="outline"
            class="h-11 shrink-0 px-3 text-sm lg:h-9"
            :disabled="addingEmail === entry.email || addedEmails.has(entry.email)"
            :aria-label="addedEmails.has(entry.email) ? t('contacts.directory.added', { name: entry.name || entry.email }) : t('contacts.directory.addAriaLabel', { name: entry.name || entry.email })"
            @click="addToContacts(entry)"
          >
            <UserPlus class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline" aria-hidden="true">{{ addedEmails.has(entry.email) ? t('contacts.directory.addedShort') : t('contacts.directory.addAction') }}</span>
          </Button>
        </li>
      </ul>
    </div>
  </div>
</template>
