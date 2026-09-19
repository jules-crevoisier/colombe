<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import type { ContactDetailInput, EmailLabel, PhoneLabel } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'

/**
 * Formulaire de contact (création ET modification), docs/dev/PLAN-v3.md R2.3.
 * Champs contractuels : Prénom, Nom, Nom affiché, e-mails/téléphones libellés
 * et répétables, Organisation, Fonction, Adresse, Date de naissance, Notes.
 */
const props = defineProps<{ submitLabel?: string }>()
const emit = defineEmits<{ submit: [ContactDetailInput], cancel: [] }>()
const model = defineModel<ContactDetailInput>({ required: true })

const { t } = useI18n()

const EMAIL_LABELS: Array<{ value: EmailLabel }> = [
  { value: 'home' },
  { value: 'work' },
  { value: 'other' },
]
const PHONE_LABELS: Array<{ value: PhoneLabel }> = [
  { value: 'home' },
  { value: 'work' },
  { value: 'mobile' },
  { value: 'other' },
]

function addEmail() {
  model.value = { ...model.value, emails: [...model.value.emails, { label: 'other', address: '' }] }
}
function removeEmail(i: number) {
  model.value = { ...model.value, emails: model.value.emails.filter((_, idx) => idx !== i) }
}
function addPhone() {
  model.value = { ...model.value, phones: [...model.value.phones, { label: 'mobile', number: '' }] }
}
function removePhone(i: number) {
  model.value = { ...model.value, phones: model.value.phones.filter((_, idx) => idx !== i) }
}

function ensureAddress() {
  if (!model.value.address) model.value = { ...model.value, address: { street: '', postalCode: '', city: '', country: '' } }
}

function submit() {
  emit('submit', model.value)
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="flex flex-col gap-1">
        <Label for="contact-first-name">{{ t('contacts.form.firstName') }}</Label>
        <Input id="contact-first-name" v-model="model.firstName" class="h-11 text-base" autocomplete="off" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="contact-last-name">{{ t('contacts.nameLabel') }}</Label>
        <Input id="contact-last-name" v-model="model.lastName" class="h-11 text-base" autocomplete="off" />
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <Label for="contact-display-name">{{ t('contacts.form.displayName') }}</Label>
      <Input id="contact-display-name" v-model="model.displayName" class="h-11 text-base" autocomplete="off" :placeholder="t('contacts.form.displayNamePlaceholder')" />
    </div>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">{{ t('contacts.form.emailsLegend') }}</legend>
      <div v-for="(email, i) in model.emails" :key="i" class="flex flex-wrap items-end gap-2">
        <div class="flex min-w-40 flex-1 flex-col gap-1">
          <Label :for="`contact-email-${i}`">{{ t('contacts.form.emailLabel') }}</Label>
          <Input :id="`contact-email-${i}`" v-model="email.address" type="email" class="h-11 text-base" autocomplete="off" />
        </div>
        <div class="flex w-28 min-w-28 flex-col gap-1">
          <Label :for="`contact-email-label-${i}`">{{ t('contacts.form.typeLabel') }}</Label>
          <Select :model-value="email.label" @update:model-value="(v) => { email.label = v as typeof email.label }">
            <SelectTrigger :id="`contact-email-label-${i}`" class="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in EMAIL_LABELS" :key="opt.value" :value="opt.value">{{ t(`contacts.labels.${opt.value}`) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MailIconButton :icon="X" :label="t('contacts.form.removeEmail')" class="mb-0.5" :disabled="model.emails.length <= 1" @click="removeEmail(i)" />
      </div>
      <Button type="button" variant="outline" class="h-10 w-fit rounded-lg px-4 text-sm" @click="addEmail">
        <Plus class="size-4" aria-hidden="true" /> {{ t('contacts.form.addEmail') }}
      </Button>
    </fieldset>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">{{ t('contacts.form.phonesLegend') }}</legend>
      <div v-for="(phone, i) in model.phones" :key="i" class="flex flex-wrap items-end gap-2">
        <div class="flex min-w-40 flex-1 flex-col gap-1">
          <Label :for="`contact-phone-${i}`">{{ t('contacts.form.phoneLabel') }}</Label>
          <Input :id="`contact-phone-${i}`" v-model="phone.number" type="tel" class="h-11 text-base" autocomplete="off" />
        </div>
        <div class="flex w-28 min-w-28 flex-col gap-1">
          <Label :for="`contact-phone-label-${i}`">{{ t('contacts.form.typeLabel') }}</Label>
          <Select :model-value="phone.label" @update:model-value="(v) => { phone.label = v as typeof phone.label }">
            <SelectTrigger :id="`contact-phone-label-${i}`" class="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in PHONE_LABELS" :key="opt.value" :value="opt.value">{{ t(`contacts.labels.${opt.value}`) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MailIconButton :icon="X" :label="t('contacts.form.removePhone')" class="mb-0.5" @click="removePhone(i)" />
      </div>
      <Button type="button" variant="outline" class="h-10 w-fit rounded-lg px-4 text-sm" @click="addPhone">
        <Plus class="size-4" aria-hidden="true" /> {{ t('contacts.form.addPhone') }}
      </Button>
    </fieldset>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="flex flex-col gap-1">
        <Label for="contact-org">{{ t('contacts.form.organization') }}</Label>
        <Input id="contact-org" v-model="model.organization" class="h-11 text-base" autocomplete="off" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="contact-job-title">{{ t('contacts.form.jobTitle') }}</Label>
        <Input id="contact-job-title" v-model="model.jobTitle" class="h-11 text-base" autocomplete="off" />
      </div>
    </div>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">{{ t('contacts.address') }}</legend>
      <div class="flex flex-col gap-1">
        <Label for="contact-address-street">{{ t('contacts.address') }}</Label>
        <Input
          id="contact-address-street"
          :model-value="model.address?.street ?? ''"
          class="h-11 text-base"
          autocomplete="off"
          @update:model-value="(v) => { ensureAddress(); model.address!.street = String(v) }"
        />
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="flex flex-col gap-1">
          <Label for="contact-address-postal-code">{{ t('contacts.form.postalCode') }}</Label>
          <Input
            id="contact-address-postal-code"
            :model-value="model.address?.postalCode ?? ''"
            class="h-11 text-base"
            autocomplete="off"
            @update:model-value="(v) => { ensureAddress(); model.address!.postalCode = String(v) }"
          />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="contact-address-city">{{ t('contacts.form.city') }}</Label>
          <Input
            id="contact-address-city"
            :model-value="model.address?.city ?? ''"
            class="h-11 text-base"
            autocomplete="off"
            @update:model-value="(v) => { ensureAddress(); model.address!.city = String(v) }"
          />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="contact-address-country">{{ t('contacts.form.country') }}</Label>
          <Input
            id="contact-address-country"
            :model-value="model.address?.country ?? ''"
            class="h-11 text-base"
            autocomplete="off"
            @update:model-value="(v) => { ensureAddress(); model.address!.country = String(v) }"
          />
        </div>
      </div>
    </fieldset>

    <div class="flex flex-col gap-1">
      <Label for="contact-birthday">{{ t('contacts.form.birthday') }}</Label>
      <Input
        id="contact-birthday"
        :model-value="model.birthday ?? ''"
        type="date"
        class="h-11 w-full text-base sm:w-56"
        @update:model-value="(v) => { model.birthday = String(v) || null }"
      />
    </div>

    <div class="flex flex-col gap-1">
      <Label for="contact-notes">{{ t('contacts.notes') }}</Label>
      <Textarea id="contact-notes" v-model="model.notes" class="min-h-24 text-base" />
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" class="h-11 rounded-lg px-5" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button type="submit" class="h-11 rounded-lg px-5">{{ props.submitLabel ?? t('common.save') }}</Button>
    </div>
  </form>
</template>
