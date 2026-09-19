<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ArrowLeft, Mail, Pencil, Trash2, UsersRound } from '@lucide/vue'
import type { ContactDetail, ContactDetailInput, ContactGroup } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ id: number, groups: ContactGroup[] }>()
const emit = defineEmits<{ close: [], deleted: [], saved: [ContactDetail] }>()

const { t } = useI18n()
const api = useContactsApi()
const compose = useComposeStore()

const contact = ref<ContactDetail | null>(null)
const loading = ref(true)
const failed = ref(false)
const editing = ref(false)
const saving = ref(false)
const form = ref<ContactDetailInput | null>(null)
const deleteConfirm = ref(false)

function emptyInput(): ContactDetailInput {
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

function toInput(c: ContactDetail): ContactDetailInput {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: c.displayName,
    emails: c.emails.length ? c.emails.map(e => ({ ...e })) : [{ label: 'other', address: c.email }],
    phones: c.phones.map(p => ({ ...p })),
    organization: c.organization,
    jobTitle: c.jobTitle,
    address: c.address ? { ...c.address } : null,
    birthday: c.birthday,
    notes: c.notes,
  }
}

async function load() {
  loading.value = true
  failed.value = false
  editing.value = false
  try {
    contact.value = await api.get(props.id)
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}
watch(() => props.id, load, { immediate: true })

const memberOf = computed(() => new Set(contact.value?.groupIds ?? []))
const availableGroups = computed(() => props.groups.filter(g => !memberOf.value.has(g.id)))

function startEdit() {
  if (!contact.value) return
  form.value = toInput(contact.value)
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  form.value = null
}

async function submitEdit(input: ContactDetailInput) {
  saving.value = true
  try {
    contact.value = await api.update(props.id, input)
    editing.value = false
    form.value = null
    toast.success(t('contacts.detail.saved'))
    emit('saved', contact.value)
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.detail.saveFailed')))
  }
  finally {
    saving.value = false
  }
}

async function confirmDelete() {
  deleteConfirm.value = false
  try {
    await api.remove(props.id)
    toast(t('contacts.detail.deleted'))
    emit('deleted')
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.detail.deleteFailed')))
  }
}

function writeMessage() {
  if (!contact.value) return
  void compose.openNew([contact.value.email])
}

async function addToGroup(groupId: number) {
  try {
    await api.addToGroup(groupId, [props.id])
    if (contact.value) contact.value.groupIds = [...contact.value.groupIds, groupId]
    toast.success(t('contacts.detail.addedToGroup'))
  }
  catch (err) {
    toast.error(errorText(err, t('contacts.detail.addToGroupFailed')))
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2">
      <MailIconButton :icon="ArrowLeft" :label="t('contacts.detail.back')" class="lg:hidden" @click="emit('close')" />
      <h2 class="min-w-0 flex-1 truncate px-2 font-heading text-xl font-medium">{{ contact?.name || t('contacts.detail.fallbackName') }}</h2>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <div v-if="loading" class="flex flex-col gap-3">
        <Skeleton class="h-10 w-2/3" />
        <Skeleton class="h-24 w-full" />
      </div>
      <p v-else-if="failed" role="alert" class="text-sm text-destructive">{{ t('contacts.detail.loadFailed') }}</p>

      <ContactsContactForm v-else-if="editing && form" v-model="form" :submit-label="t('common.save')" @submit="submitEdit" @cancel="cancelEdit" />

      <template v-else-if="contact">
        <div class="flex items-start gap-3">
          <span class="grid size-14 shrink-0 place-items-center rounded-full text-lg font-semibold text-white" :class="getAvatarTone(contact.email)" aria-hidden="true">
            {{ getInitials(contact.name || contact.email) }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="font-heading text-2xl leading-tight font-medium">{{ contact.name || contact.email }}</p>
            <p v-if="contact.jobTitle || contact.organization" class="text-sm text-muted-foreground">
              {{ [contact.jobTitle, contact.organization].filter(Boolean).join(' — ') }}
            </p>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" class="h-11 rounded-lg px-4" @click="startEdit">
            <Pencil class="size-4" aria-hidden="true" /> {{ t('common.edit') }}
          </Button>
          <Button variant="outline" class="h-11 rounded-lg px-4" @click="writeMessage">
            <Mail class="size-4" aria-hidden="true" /> {{ t('contacts.detail.writeMessage') }}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="h-11 rounded-lg px-4">
                <UsersRound class="size-4" aria-hidden="true" /> {{ t('contacts.detail.addToGroup') }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem v-if="!availableGroups.length" disabled>{{ t('contacts.detail.noGroupsAvailable') }}</DropdownMenuItem>
              <DropdownMenuItem v-for="g in availableGroups" :key="g.id" @select="addToGroup(g.id)">
                {{ g.name }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" class="h-11 rounded-lg px-4 text-destructive hover:text-destructive" @click="deleteConfirm = true">
            <Trash2 class="size-4" aria-hidden="true" /> {{ t('common.delete') }}
          </Button>
        </div>

        <dl class="mt-6 flex flex-col gap-3 text-sm">
          <div v-for="(email, i) in contact.emails" :key="`e${i}`" class="flex items-baseline gap-2">
            <dt class="w-24 shrink-0 text-muted-foreground">{{ t(`contacts.labels.${email.label}`) }}</dt>
            <dd class="break-all">{{ email.address }}</dd>
          </div>
          <div v-for="(phone, i) in contact.phones" :key="`p${i}`" class="flex items-baseline gap-2">
            <dt class="w-24 shrink-0 text-muted-foreground">{{ t(`contacts.labels.${phone.label}`) }}</dt>
            <dd>{{ phone.number }}</dd>
          </div>
          <div v-if="contact.address" class="flex items-baseline gap-2">
            <dt class="w-24 shrink-0 text-muted-foreground">{{ t('contacts.address') }}</dt>
            <dd>{{ [contact.address.street, contact.address.postalCode, contact.address.city, contact.address.country].filter(Boolean).join(', ') }}</dd>
          </div>
          <div v-if="contact.birthday" class="flex items-baseline gap-2">
            <dt class="w-24 shrink-0 text-muted-foreground">{{ t('contacts.detail.birthday') }}</dt>
            <dd>{{ contact.birthday }}</dd>
          </div>
          <div v-if="contact.notes" class="flex items-baseline gap-2">
            <dt class="w-24 shrink-0 text-muted-foreground">{{ t('contacts.notes') }}</dt>
            <dd class="whitespace-pre-wrap">{{ contact.notes }}</dd>
          </div>
        </dl>
      </template>
    </div>

    <AlertDialog :open="deleteConfirm" @update:open="(v: boolean) => { if (!v) deleteConfirm = false }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('contacts.detail.deleteConfirmTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('contacts.detail.deleteConfirmDescription') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel class="h-11 rounded-lg">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="h-11 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDelete">{{ t('common.delete') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
