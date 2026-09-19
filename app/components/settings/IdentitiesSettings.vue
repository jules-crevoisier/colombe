<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Plus, Star } from '@lucide/vue'
import type { Identity, IdentityInput } from '#shared/types/mail'

const MAX_IDENTITIES = 20
const MAX_SIGNATURE_IMAGES = 3

const api = useSettingsApi()

const identities = ref<Identity[]>([])
const loading = ref(true)
const selectedId = ref<number | null>(null)
const creating = ref(false)
const saving = ref(false)
const deleteDialogOpen = ref(false)

function blankForm(): IdentityInput {
  return { name: '', replyTo: '', bcc: '', organization: '', signatureHtml: '', isDefault: false }
}

const form = reactive<IdentityInput>(blankForm())

const selected = computed(() => identities.value.find(i => i.id === selectedId.value) ?? null)
const canDelete = computed(() => !creating.value && identities.value.length > 1)
const canAdd = computed(() => identities.value.length < MAX_IDENTITIES)

async function load() {
  loading.value = true
  try {
    identities.value = await api.identities()
    const def = identities.value.find(i => i.isDefault) ?? identities.value[0] ?? null
    if (def) select(def.id)
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible de charger les identités.'))
  }
  finally {
    loading.value = false
  }
}

function select(id: number) {
  const identity = identities.value.find(i => i.id === id)
  if (!identity) return
  creating.value = false
  selectedId.value = id
  Object.assign(form, {
    name: identity.name,
    replyTo: identity.replyTo,
    bcc: identity.bcc,
    organization: identity.organization,
    signatureHtml: identity.signatureHtml,
    isDefault: identity.isDefault,
  })
}

function startCreate() {
  creating.value = true
  selectedId.value = null
  Object.assign(form, blankForm())
}

async function save() {
  if (!form.name.trim()) {
    toast.error('Entrez un nom affiché.')
    return
  }
  saving.value = true
  try {
    if (creating.value) {
      const created = await api.createIdentity({ ...form })
      identities.value.push(created)
      creating.value = false
      selectedId.value = created.id
      toast.success('Identité créée.')
    }
    else if (selectedId.value != null) {
      const updated = await api.updateIdentity(selectedId.value, { ...form })
      const index = identities.value.findIndex(i => i.id === updated.id)
      if (index >= 0) identities.value[index] = updated
      // Une identité par défaut le devient pour toutes les autres.
      if (updated.isDefault) {
        for (const i of identities.value) {
          if (i.id !== updated.id) i.isDefault = false
        }
      }
      toast.success('Identité enregistrée.')
    }
  }
  catch (err) {
    toast.error(errorText(err, 'Impossible d\'enregistrer l\'identité.'))
  }
  finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (selectedId.value == null) return
  try {
    await api.deleteIdentity(selectedId.value)
    identities.value = identities.value.filter(i => i.id !== selectedId.value)
    deleteDialogOpen.value = false
    const next = identities.value.find(i => i.isDefault) ?? identities.value[0] ?? null
    if (next) select(next.id)
    toast.success('Identité supprimée.')
  }
  catch (err) {
    deleteDialogOpen.value = false
    toast.error(errorText(err, 'Impossible de supprimer cette identité.'))
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="space-y-3">
      <Skeleton class="h-11 w-full" />
      <Skeleton class="h-40 w-full" />
    </div>

    <template v-else>
      <div class="flex flex-col gap-2">
        <ul aria-label="Identités" class="flex flex-col gap-2">
          <li v-for="identity in identities" :key="identity.id">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-2 text-left transition-colors hover:bg-accent"
              :class="identity.id === selectedId && !creating ? 'border-primary bg-accent' : 'border-border'"
              :aria-current="identity.id === selectedId && !creating ? 'true' : undefined"
              @click="select(identity.id)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ identity.name || identity.email }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ identity.email }}</span>
              </span>
              <Star v-if="identity.isDefault" class="size-4 shrink-0 fill-current text-primary" role="img" aria-label="Identité par défaut" />
            </button>
          </li>
        </ul>

        <Button variant="outline" class="h-11 justify-start rounded-lg" :disabled="!canAdd" @click="startCreate">
          <Plus class="size-4" aria-hidden="true" />
          Ajouter une identité
        </Button>
        <p v-if="!canAdd" class="text-xs text-muted-foreground">Limite de {{ MAX_IDENTITIES }} identités atteinte.</p>
      </div>

      <form v-if="creating || selected" class="flex flex-col gap-6 rounded-xl border border-border p-4" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <Label for="identity-name">Nom affiché</Label>
            <Input id="identity-name" v-model="form.name" class="h-11 text-base" required />
          </div>
          <div class="space-y-2">
            <Label for="identity-reply-to">Répondre à</Label>
            <Input id="identity-reply-to" v-model="form.replyTo" type="email" class="h-11 text-base" />
          </div>
          <div class="space-y-2">
            <Label for="identity-bcc">Copie cachée automatique</Label>
            <Input id="identity-bcc" v-model="form.bcc" type="email" class="h-11 text-base" />
          </div>
          <div class="space-y-2">
            <Label for="identity-organization">Organisation</Label>
            <Input id="identity-organization" v-model="form.organization" class="h-11 text-base" />
          </div>
        </div>

        <div class="space-y-2">
          <Label for="identity-signature">Signature</Label>
          <div class="flex min-h-56 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel focus-within:ring-2 focus-within:ring-ring">
            <MailRichEditor id="identity-signature" v-model:html="form.signatureHtml" label="Signature" :max-images="MAX_SIGNATURE_IMAGES" placeholder="Prénom Nom — fonction, département MMI, téléphone…" />
          </div>
        </div>

        <label class="flex min-h-11 cursor-pointer items-center gap-3">
          <Checkbox :model-value="form.isDefault" @update:model-value="(v) => form.isDefault = v === true" />
          Identité par défaut
        </label>

        <div class="flex flex-wrap items-center justify-end gap-3">
          <Button v-if="canDelete" type="button" variant="destructive" class="h-11 rounded-lg px-6" @click="deleteDialogOpen = true">
            Supprimer l'identité
          </Button>
          <Button type="submit" class="h-11 rounded-lg px-6" :disabled="saving">
            {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
          </Button>
        </div>
      </form>

      <AlertDialog v-model:open="deleteDialogOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette identité ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est définitive.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction @click="confirmDelete">Supprimer l'identité</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </template>
  </div>
</template>
