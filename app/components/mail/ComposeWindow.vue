<script setup lang="ts">
import { toast } from 'vue-sonner'
import { onKeyStroke } from '@vueuse/core'
import { Maximize2, Minimize2, Minus, Paperclip, Send, Trash2, X } from '@lucide/vue'

const compose = useComposeStore()
const fileInput = ref<HTMLInputElement | null>(null)
const toField = ref<{ commit: () => void } | null>(null)
const ccField = ref<{ commit: () => void } | null>(null)
const bccField = ref<{ commit: () => void } | null>(null)
const editor = ref<{ focusStart: () => void } | null>(null)

const saveLabel = computed(() => ({
  idle: '',
  saving: 'Enregistrement…',
  saved: 'Brouillon enregistré',
  error: 'Échec de l’enregistrement',
}[compose.saveState]))

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

async function onSend() {
  for (const f of [toField, ccField, bccField]) f.value?.commit()
  const all = [...compose.to, ...compose.cc, ...compose.bcc]
  if (!all.length) {
    toast.error('Ajoutez au moins un destinataire.')
    return
  }
  const invalid = all.filter(a => !validateEmailAddress(a))
  if (invalid.length) {
    toast.error(`Adresse invalide : ${invalid.join(', ')}`)
    return
  }
  if (!compose.subject.trim() && !window.confirm('Envoyer ce message sans objet ?')) return
  await compose.send()
}

function onFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) void compose.addFiles(files)
  if (fileInput.value) fileInput.value.value = ''
}

// Ctrl/Cmd + Entrée : envoyer.
onKeyStroke('Enter', (e) => {
  if (compose.isOpen && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void onSend()
  }
})

// Réponse : curseur au début du corps (la citation est en dessous).
watch(() => compose.isOpen, async (open) => {
  if (!open) return
  await nextTick()
  if (compose.to.length) editor.value?.focusStart()
})

function onBodyChange(text: string) {
  compose.text = text
  compose.touch()
}

// Avertit avant de quitter la page si une modification n'est pas enregistrée.
function beforeUnload(e: BeforeUnloadEvent) {
  if ((compose.isOpen && compose.dirty && !compose.isEmpty) || compose.pendingSend) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <section
    v-if="compose.isOpen"
    role="dialog"
    aria-labelledby="compose-title"
    class="fixed inset-0 z-40 flex flex-col bg-surface-panel lg:inset-auto lg:right-6 lg:bottom-0 lg:overflow-hidden lg:rounded-t-xl lg:shadow-2xl"
    :class="[
      compose.minimized ? 'lg:w-80' : compose.expanded ? 'lg:top-10 lg:right-[10vw] lg:left-[10vw] lg:rounded-xl lg:bottom-10' : 'lg:h-[min(640px,85dvh)] lg:w-[560px]',
      compose.minimized ? 'hidden lg:flex' : '',
    ]"
    @keydown.esc="compose.close()"
  >
    <header
      class="flex h-14 shrink-0 items-center gap-1 border-b border-border/60 pr-1 pl-4 lg:h-10 lg:cursor-pointer lg:border-0 lg:bg-secondary lg:pl-4"
      @click.self="compose.minimized = !compose.minimized"
    >
      <h2 id="compose-title" class="min-w-0 flex-1 truncate text-base font-medium lg:text-sm" @click="compose.minimized = !compose.minimized">{{ compose.title }}</h2>
      <MailIconButton class="hidden lg:inline-flex" :icon="Minus" :label="compose.minimized ? 'Agrandir' : 'Réduire'" @click="compose.minimized = !compose.minimized" />
      <MailIconButton class="hidden lg:inline-flex" :icon="compose.expanded ? Minimize2 : Maximize2" :label="compose.expanded ? 'Quitter le plein écran' : 'Plein écran'" @click="compose.expanded = !compose.expanded; compose.minimized = false" />
      <MailIconButton :icon="X" label="Enregistrer et fermer" @click="compose.close()" />
    </header>

    <form v-show="!compose.minimized" class="flex min-h-0 flex-1 flex-col" @submit.prevent="onSend">
      <div class="px-4">
        <div class="flex items-start">
          <div class="min-w-0 flex-1">
            <MailRecipientInput id="compose-to" ref="toField" v-model="compose.to" label="À" :autofocus="!compose.to.length" @change="compose.touch()" />
          </div>
          <button v-if="!compose.showCc" type="button" class="h-11 shrink-0 px-2 text-sm text-muted-foreground hover:text-foreground hover:underline" @click="compose.showCc = true">Cc Cci</button>
        </div>
        <template v-if="compose.showCc">
          <MailRecipientInput id="compose-cc" ref="ccField" v-model="compose.cc" label="Cc" @change="compose.touch()" />
          <MailRecipientInput id="compose-bcc" ref="bccField" v-model="compose.bcc" label="Cci" @change="compose.touch()" />
        </template>
        <div class="flex min-h-11 items-center border-b border-border/60">
          <label for="compose-subject" class="sr-only">Objet</label>
          <input id="compose-subject" v-model="compose.subject" placeholder="Objet" maxlength="998" class="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground" @input="compose.touch()">
        </div>
      </div>

      <MailRichEditor id="compose-body" ref="editor" v-model:html="compose.html" @change="onBodyChange" />

      <ul v-if="compose.attachments.length" class="flex flex-col gap-1 px-4 pb-2" aria-label="Pièces jointes">
        <li v-for="(a, i) in compose.attachments" :key="`${a.filename}-${i}`" class="flex h-9 items-center gap-2 rounded-lg bg-secondary pr-1 pl-3 text-sm">
          <span class="min-w-0 flex-1 truncate font-medium">{{ a.filename }}</span>
          <span class="text-xs text-muted-foreground">{{ formatSize(a.size) }}</span>
          <button type="button" class="grid size-8 place-items-center rounded-full hover:bg-foreground/10" :aria-label="`Retirer ${a.filename}`" @click="compose.removeAttachment(i)">
            <X class="size-4" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <footer class="flex shrink-0 items-center gap-1 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="submit" class="h-11 rounded-full px-6 font-medium" :disabled="compose.sending">
          <Send class="size-4" aria-hidden="true" />
          {{ compose.sending ? 'Envoi…' : 'Envoyer' }}
        </Button>
        <input ref="fileInput" type="file" multiple class="sr-only" tabindex="-1" aria-hidden="true" @change="onFiles">
        <MailIconButton :icon="Paperclip" label="Joindre des fichiers" @click="fileInput?.click()" />
        <span class="ml-1 min-w-0 flex-1 truncate text-xs text-muted-foreground" role="status" aria-live="polite">{{ saveLabel }}</span>
        <MailIconButton :icon="Trash2" label="Supprimer le brouillon" @click="compose.discard()" />
      </footer>
    </form>
  </section>
</template>
