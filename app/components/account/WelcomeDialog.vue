<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'

/**
 * Première connexion (docs/dev/PLAN-v3.md R2.1) : demande le nom affiché de
 * l'identité par défaut, tant que prefs.welcomed est faux. Ne se ferme
 * qu'en validant « Continuer ».
 */
const { t } = useI18n()
const prefs = usePrefsStore()
const settingsApi = useSettingsApi()

const open = ref(false)
const name = ref('')
const defaultIdentityId = ref<number | null>(null)
const saving = ref(false)
const checked = ref(false)

async function check() {
  if (checked.value) return
  checked.value = true
  try {
    if (!prefs.loaded) await prefs.load()
    if (prefs.prefs.welcomed) return
    const identities = await settingsApi.identities()
    const identity = identities.find(i => i.isDefault) ?? identities[0] ?? null
    if (!identity) return
    defaultIdentityId.value = identity.id
    name.value = identity.name
    open.value = true
  }
  catch {
    // Une panne réseau ne doit jamais bloquer l'accès à la messagerie.
  }
}

async function submit() {
  if (!name.value.trim() || defaultIdentityId.value == null || saving.value) return
  saving.value = true
  try {
    await settingsApi.updateIdentity(defaultIdentityId.value, { name: name.value.trim() })
    await prefs.save({ welcomed: true })
    open.value = false
  }
  catch (err) {
    toast.error(errorText(err, t('account.welcome.saveFailed')))
  }
  finally {
    saving.value = false
  }
}

onMounted(check)
</script>

<template>
  <Dialog :open="open" @update:open="() => {}">
    <DialogContent class="sm:max-w-md" :show-close-button="false" @escape-key-down.prevent @pointer-down-outside.prevent>
      <DialogHeader>
        <BrandDove class="mb-1 w-28" :trail="false" />
        <DialogTitle class="text-2xl">{{ t('account.welcome.title') }}</DialogTitle>
        <DialogDescription>{{ t('account.welcome.description') }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="space-y-2">
          <Label for="welcome-name">{{ t('account.welcome.nameLabel') }}</Label>
          <Input id="welcome-name" v-model="name" class="h-11 text-base" autofocus required />
        </div>
        <DialogFooter>
          <Button type="submit" class="h-11 rounded-lg px-6" :disabled="!name.trim() || saving">
            {{ saving ? t('common.saving') : t('account.welcome.continue') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
