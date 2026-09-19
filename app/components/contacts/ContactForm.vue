<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import type { ContactDetailInput, EmailLabel, PhoneLabel } from '#shared/types/mail'

/**
 * Formulaire de contact (création ET modification), docs/dev/PLAN-v3.md R2.3.
 * Champs contractuels : Prénom, Nom, Nom affiché, e-mails/téléphones libellés
 * et répétables, Organisation, Fonction, Adresse, Date de naissance, Notes.
 */
const props = defineProps<{ submitLabel?: string }>()
const emit = defineEmits<{ submit: [ContactDetailInput], cancel: [] }>()
const model = defineModel<ContactDetailInput>({ required: true })

const EMAIL_LABELS: Array<{ value: EmailLabel, text: string }> = [
  { value: 'home', text: 'Domicile' },
  { value: 'work', text: 'Travail' },
  { value: 'other', text: 'Autre' },
]
const PHONE_LABELS: Array<{ value: PhoneLabel, text: string }> = [
  { value: 'home', text: 'Domicile' },
  { value: 'work', text: 'Travail' },
  { value: 'mobile', text: 'Mobile' },
  { value: 'other', text: 'Autre' },
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
        <Label for="contact-first-name">Prénom</Label>
        <Input id="contact-first-name" v-model="model.firstName" class="h-11 text-base" autocomplete="off" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="contact-last-name">Nom</Label>
        <Input id="contact-last-name" v-model="model.lastName" class="h-11 text-base" autocomplete="off" />
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <Label for="contact-display-name">Nom affiché</Label>
      <Input id="contact-display-name" v-model="model.displayName" class="h-11 text-base" autocomplete="off" placeholder="Vide = Prénom Nom" />
    </div>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">Adresses e-mail</legend>
      <div v-for="(email, i) in model.emails" :key="i" class="flex flex-wrap items-end gap-2">
        <div class="flex min-w-40 flex-1 flex-col gap-1">
          <Label :for="`contact-email-${i}`">E-mail</Label>
          <Input :id="`contact-email-${i}`" v-model="email.address" type="email" class="h-11 text-base" autocomplete="off" />
        </div>
        <div class="flex w-28 min-w-28 flex-col gap-1">
          <Label :for="`contact-email-label-${i}`">Type</Label>
          <Select :model-value="email.label" @update:model-value="(v) => { email.label = v as typeof email.label }">
            <SelectTrigger :id="`contact-email-label-${i}`" class="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in EMAIL_LABELS" :key="opt.value" :value="opt.value">{{ opt.text }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MailIconButton :icon="X" label="Retirer cet e-mail" class="mb-0.5" :disabled="model.emails.length <= 1" @click="removeEmail(i)" />
      </div>
      <Button type="button" variant="outline" class="h-10 w-fit rounded-lg px-4 text-sm" @click="addEmail">
        <Plus class="size-4" aria-hidden="true" /> Ajouter un e-mail
      </Button>
    </fieldset>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">Téléphones</legend>
      <div v-for="(phone, i) in model.phones" :key="i" class="flex flex-wrap items-end gap-2">
        <div class="flex min-w-40 flex-1 flex-col gap-1">
          <Label :for="`contact-phone-${i}`">Téléphone</Label>
          <Input :id="`contact-phone-${i}`" v-model="phone.number" type="tel" class="h-11 text-base" autocomplete="off" />
        </div>
        <div class="flex w-28 min-w-28 flex-col gap-1">
          <Label :for="`contact-phone-label-${i}`">Type</Label>
          <Select :model-value="phone.label" @update:model-value="(v) => { phone.label = v as typeof phone.label }">
            <SelectTrigger :id="`contact-phone-label-${i}`" class="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in PHONE_LABELS" :key="opt.value" :value="opt.value">{{ opt.text }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MailIconButton :icon="X" label="Retirer ce téléphone" class="mb-0.5" @click="removePhone(i)" />
      </div>
      <Button type="button" variant="outline" class="h-10 w-fit rounded-lg px-4 text-sm" @click="addPhone">
        <Plus class="size-4" aria-hidden="true" /> Ajouter un téléphone
      </Button>
    </fieldset>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="flex flex-col gap-1">
        <Label for="contact-org">Organisation</Label>
        <Input id="contact-org" v-model="model.organization" class="h-11 text-base" autocomplete="off" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="contact-job-title">Fonction</Label>
        <Input id="contact-job-title" v-model="model.jobTitle" class="h-11 text-base" autocomplete="off" />
      </div>
    </div>

    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">Adresse</legend>
      <div class="flex flex-col gap-1">
        <Label for="contact-address-street">Adresse</Label>
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
          <Label for="contact-address-postal-code">Code postal</Label>
          <Input
            id="contact-address-postal-code"
            :model-value="model.address?.postalCode ?? ''"
            class="h-11 text-base"
            autocomplete="off"
            @update:model-value="(v) => { ensureAddress(); model.address!.postalCode = String(v) }"
          />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="contact-address-city">Ville</Label>
          <Input
            id="contact-address-city"
            :model-value="model.address?.city ?? ''"
            class="h-11 text-base"
            autocomplete="off"
            @update:model-value="(v) => { ensureAddress(); model.address!.city = String(v) }"
          />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="contact-address-country">Pays</Label>
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
      <Label for="contact-birthday">Date de naissance</Label>
      <Input
        id="contact-birthday"
        :model-value="model.birthday ?? ''"
        type="date"
        class="h-11 w-full text-base sm:w-56"
        @update:model-value="(v) => { model.birthday = String(v) || null }"
      />
    </div>

    <div class="flex flex-col gap-1">
      <Label for="contact-notes">Notes</Label>
      <Textarea id="contact-notes" v-model="model.notes" class="min-h-24 text-base" />
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" class="h-11 rounded-lg px-5" @click="emit('cancel')">Annuler</Button>
      <Button type="submit" class="h-11 rounded-lg px-5">{{ props.submitLabel ?? 'Enregistrer' }}</Button>
    </div>
  </form>
</template>
