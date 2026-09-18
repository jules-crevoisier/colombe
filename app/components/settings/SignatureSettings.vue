<script setup lang="ts">
import { toast } from 'vue-sonner'

/**
 * Signature : éditée avec le même éditeur riche que les messages (gras, liens…),
 * assainie côté serveur à l'enregistrement. L'interrupteur décide seulement si
 * elle est insérée automatiquement dans les nouveaux messages.
 */
const prefs = usePrefsStore()

const draft = ref(prefs.prefs.signatureHtml)
const saving = ref(false)
const dirty = computed(() => draft.value !== prefs.prefs.signatureHtml)

// Les préférences peuvent arriver après le montage (premier chargement).
watch(() => prefs.prefs.signatureHtml, (value) => {
  if (!saving.value) draft.value = value
})

async function save() {
  saving.value = true
  try {
    await prefs.save({ signatureHtml: draft.value })
    // Le serveur renvoie la version assainie : on s'aligne dessus.
    draft.value = prefs.prefs.signatureHtml
  }
  finally {
    saving.value = false
  }
}

function toggle(enabled: boolean) {
  if (enabled && !draft.value.trim()) toast('Rédigez votre signature ci-dessous, puis enregistrez-la.')
  void prefs.save({ signatureEnabled: enabled })
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
      <div class="flex flex-col gap-1">
        <Label for="signature-enabled" class="text-base font-medium">Insérer ma signature dans les nouveaux messages</Label>
        <p class="text-sm text-muted-foreground">Également dans les réponses et transferts, au-dessus du message cité.</p>
      </div>
      <Switch id="signature-enabled" :model-value="prefs.prefs.signatureEnabled" @update:model-value="toggle" />
    </div>

    <div class="flex flex-col gap-2">
      <Label for="signature-editor" class="text-base font-medium">Ma signature</Label>
      <div class="flex min-h-56 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel focus-within:ring-2 focus-within:ring-ring">
        <MailRichEditor id="signature-editor" v-model:html="draft" placeholder="Prénom Nom — fonction, département MMI, téléphone…" label="Signature" />
      </div>
      <p class="text-xs text-muted-foreground">Gras, italique, listes et liens sont conservés. Les images et styles personnalisés sont retirés pour des raisons de sécurité.</p>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-3">
      <span v-if="dirty" class="text-sm text-muted-foreground" role="status">Modifications non enregistrées</span>
      <Button class="h-11 rounded-full px-6" :disabled="saving || !dirty" @click="save">
        {{ saving ? 'Enregistrement…' : 'Enregistrer la signature' }}
      </Button>
    </div>
  </div>
</template>
