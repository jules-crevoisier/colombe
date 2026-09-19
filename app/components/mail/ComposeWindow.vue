<script setup lang="ts">
import { toast } from 'vue-sonner'
import { onKeyStroke } from '@vueuse/core'
import { ChevronUp, FileText, Mail, Maximize2, Minimize2, Minus, Paperclip, Send, Settings, Trash2, X } from '@lucide/vue'
import type { CannedResponse } from '#shared/types/mail'

/*
 * Rédaction : une feuille qui glisse depuis la droite (bureau) ou qui recouvre l'écran
 * (mobile). Non modale sur bureau : la liste reste lisible et utilisable à gauche.
 * Réduite, elle devient un onglet « lettre » à l'encre, en bas à droite.
 */

const compose = useComposeStore()
const prefsStore = usePrefsStore()
const fileInput = ref<HTMLInputElement | null>(null)
const toField = ref<{ commit: () => void } | null>(null)
const ccField = ref<{ commit: () => void } | null>(null)
const bccField = ref<{ commit: () => void } | null>(null)
const editor = ref<{ focusStart: () => void; focusEnd: () => void; insertAtCursor: (content: string) => void } | null>(null)
const dragOver = ref(false)
const attachmentReminderOpen = ref(false)
const cannedResponses = ref<CannedResponse[]>([])
const cannedResponsesLoaded = ref(false)

async function loadCannedResponses() {
  if (cannedResponsesLoaded.value) return
  cannedResponsesLoaded.value = true
  try {
    cannedResponses.value = await useSettingsApi().responses()
  }
  catch {
    cannedResponses.value = []
  }
}

function insertCannedResponse(response: CannedResponse) {
  compose.insertCannedResponse(response.html, editor.value)
}

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

  const hasAttachments = compose.attachments.length > 0 || compose.forwardAsAttachment.length > 0
  if (!hasAttachments && mentionsAttachment(compose.html || compose.text)) {
    attachmentReminderOpen.value = true
    return
  }

  await compose.send()
}

function onFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) void compose.addFiles(files)
  if (fileInput.value) fileInput.value.value = ''
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (!e.dataTransfer?.files.length) return
  e.preventDefault()
  void compose.addFiles(e.dataTransfer.files)
}

// Ctrl/Cmd + Entrée : envoyer.
onKeyStroke('Enter', (e) => {
  if (compose.isOpen && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void onSend()
  }
})

// Réponse : curseur au début du corps (« au-dessus de la citation ») ou à la fin
// (« en dessous »), selon Prefs.replyPosition (R2.5).
watch(() => compose.isOpen, async (open) => {
  if (!open) return
  await nextTick()
  if (compose.to.length) {
    if (prefsStore.prefs.replyPosition === 'below') editor.value?.focusEnd()
    else editor.value?.focusStart()
  }
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
    class="fixed inset-0 z-40 flex animate-sheet-up flex-col bg-popover text-popover-foreground lg:inset-auto lg:animate-sheet-right lg:overflow-hidden lg:border-border lg:shadow-float"
    :class="[
      compose.minimized
        ? 'hidden lg:right-6 lg:bottom-0 lg:flex lg:w-80 lg:rounded-t-lg lg:border lg:border-b-0'
        : compose.expanded
          ? 'lg:top-0 lg:right-0 lg:bottom-0 lg:w-[min(1080px,calc(100vw-2rem))] lg:border-l'
          : 'lg:top-0 lg:right-0 lg:bottom-0 lg:w-[min(640px,calc(100vw-2rem))] lg:border-l',
    ]"
    @keydown.esc="compose.close()"
  >
    <header
      class="flex h-14 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-4 lg:pl-5"
      :class="compose.minimized ? 'lg:h-12 lg:cursor-pointer lg:border-b-0 lg:bg-compose lg:text-compose-foreground' : 'lg:h-16'"
      @click.self="compose.minimized = !compose.minimized"
    >
      <span class="mr-1 hidden size-2 shrink-0 rounded-full bg-beak lg:block" :class="compose.minimized ? '' : 'lg:hidden'" aria-hidden="true" />
      <h2 id="compose-title" class="min-w-0 flex-1 truncate font-heading text-xl font-medium tracking-[-0.01em]" :class="compose.minimized ? 'lg:font-sans lg:text-sm lg:font-semibold lg:tracking-normal' : 'lg:text-[22px]'" @click="compose.minimized = !compose.minimized">{{ compose.title }}</h2>
      <MailIconButton class="hidden lg:inline-flex" :class="compose.minimized ? 'text-compose-foreground hover:bg-white/10 hover:text-compose-foreground' : ''" :icon="compose.minimized ? ChevronUp : Minus" :label="compose.minimized ? 'Agrandir' : 'Réduire'" @click="compose.minimized = !compose.minimized" />
      <MailIconButton class="hidden lg:inline-flex" :class="compose.minimized ? 'text-compose-foreground hover:bg-white/10 hover:text-compose-foreground' : ''" :icon="compose.expanded ? Minimize2 : Maximize2" :label="compose.expanded ? 'Quitter le plein écran' : 'Plein écran'" @click="compose.expanded = !compose.expanded; compose.minimized = false" />
      <MailIconButton :class="compose.minimized ? 'lg:text-compose-foreground lg:hover:bg-white/10 lg:hover:text-compose-foreground' : ''" :icon="X" label="Enregistrer et fermer" @click="compose.close()" />
    </header>

    <form v-show="!compose.minimized" class="relative flex min-h-0 flex-1 flex-col" @submit.prevent="onSend" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
      <div class="px-4 lg:px-5">
        <!-- Sélecteur d'identité : affiché seulement si plusieurs identités existent (docs/PLAN-v3.md R2.1). -->
        <div v-if="compose.showIdentityPicker" class="flex min-h-12 items-center gap-1.5 border-b border-border py-1">
          <label for="compose-from" class="w-9 shrink-0 text-sm text-muted-foreground">De</label>
          <Select :model-value="`${compose.identityId}`" @update:model-value="(v) => compose.setIdentity(Number(v))">
            <SelectTrigger id="compose-from" class="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="identity in compose.identities" :key="identity.id" :value="`${identity.id}`">
                {{ identity.name }} &lt;{{ identity.email }}&gt;
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex items-start">
          <div class="min-w-0 flex-1">
            <MailRecipientInput id="compose-to" ref="toField" v-model="compose.to" label="À" :autofocus="!compose.to.length" @change="compose.touch()" />
          </div>
          <button v-if="!compose.showCc" type="button" class="mt-0.5 h-11 shrink-0 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" @click="compose.showCc = true">Cc Cci</button>
        </div>
        <template v-if="compose.showCc">
          <MailRecipientInput id="compose-cc" ref="ccField" v-model="compose.cc" label="Cc" @change="compose.touch()" />
          <MailRecipientInput id="compose-bcc" ref="bccField" v-model="compose.bcc" label="Cci" @change="compose.touch()" />
        </template>
        <div class="flex min-h-12 items-center border-b border-border">
          <label for="compose-subject" class="sr-only">Objet</label>
          <input id="compose-subject" v-model="compose.subject" placeholder="Objet" maxlength="998" class="h-12 w-full bg-transparent font-heading text-lg font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground" @input="compose.touch()">
        </div>
      </div>

      <MailRichEditor v-if="prefsStore.prefs.composeHtml" id="compose-body" ref="editor" v-model:html="compose.html" @change="onBodyChange" />
      <div v-else class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Textarea
          id="compose-body-text"
          v-model="compose.text"
          aria-label="Message"
          class="min-h-40 w-full resize-none border-0 bg-transparent p-0 text-base leading-relaxed shadow-none outline-none focus-visible:ring-0"
          placeholder="Rédigez votre message…"
          spellcheck="true"
          lang="fr"
          @input="compose.touch()"
        />
      </div>

      <ul v-if="compose.attachments.length || compose.forwardAsAttachment.length" class="flex flex-col gap-1.5 px-4 pb-2 lg:px-5" aria-label="Pièces jointes">
        <li v-for="(name, i) in compose.forwardAsAttachmentNames" :key="`eml-${i}`" class="flex h-11 items-center gap-2 rounded-md border border-border bg-surface-app/60 pr-1 pl-3 text-sm">
          <Mail class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ name }}</span>
          <button type="button" class="grid size-9 place-items-center rounded-md hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring" :aria-label="`Retirer ${name}`" @click="compose.removeForwardedMessage(i)">
            <X class="size-4" aria-hidden="true" />
          </button>
        </li>
        <li v-for="(a, i) in compose.attachments" :key="`${a.filename}-${i}`" class="flex h-11 items-center gap-2 rounded-md border border-border bg-surface-app/60 pr-1 pl-3 text-sm">
          <Paperclip class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ a.filename }}</span>
          <span class="text-xs text-muted-foreground tabular-nums">{{ formatSize(a.size) }}</span>
          <button type="button" class="grid size-9 place-items-center rounded-md hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring" :aria-label="`Retirer ${a.filename}`" @click="compose.removeAttachment(i)">
            <X class="size-4" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <!-- Glisser-déposer : un cadre en pointillés, comme une enveloppe à remplir -->
      <div
        v-if="dragOver"
        class="pointer-events-none absolute inset-3 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-surface-panel/90 text-center"
      >
        <p class="font-heading text-xl font-medium text-primary">Déposez les fichiers ici</p>
      </div>

      <footer class="flex shrink-0 flex-wrap items-center gap-0.5 border-t border-border px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-1 sm:px-3 lg:px-4">
        <Button type="submit" variant="beak" class="h-11 px-4 sm:mr-1 sm:px-6" :disabled="compose.sending">
          <Send class="size-4" aria-hidden="true" />
          {{ compose.sending ? 'Envoi…' : 'Envoyer' }}
        </Button>
        <input ref="fileInput" type="file" multiple class="sr-only" tabindex="-1" aria-hidden="true" @change="onFiles">
        <MailIconButton :icon="Paperclip" label="Joindre des fichiers" @click="fileInput?.click()" />
        <!-- Réponses types (docs/PLAN-v3.md R2.2) -->
        <DropdownMenu @update:open="(open: boolean) => { if (open) loadCannedResponses() }">
          <MailMenuButton :icon="FileText" label="Insérer une réponse type" />
          <DropdownMenuContent align="start" class="w-64">
            <DropdownMenuItem v-if="!cannedResponses.length" disabled>
              Aucune réponse type
            </DropdownMenuItem>
            <DropdownMenuItem v-for="response in cannedResponses" :key="response.id" @select="insertCannedResponse(response)">
              {{ response.name }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- Send options button -->
        <DropdownMenu>
          <MailMenuButton :icon="Settings" label="Options d'envoi" />
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuCheckboxItem :model-value="compose.priority === 'high'" @update:model-value="(v: boolean) => { compose.priority = v ? 'high' : 'normal'; compose.touch() }" @select.prevent>
              Priorité haute
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem :model-value="compose.requestReadReceipt" @update:model-value="(v: boolean) => { compose.requestReadReceipt = v; compose.touch() }" @select.prevent>
              Demander un accusé de lecture
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem :model-value="compose.requestDeliveryReceipt" @update:model-value="(v: boolean) => { compose.requestDeliveryReceipt = v; compose.touch() }" @select.prevent>
              Demander un accusé de remise
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span class="order-last ml-1 w-full min-w-0 truncate text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1" role="status" aria-live="polite">{{ saveLabel }}</span>
        <MailIconButton :icon="Trash2" label="Supprimer le brouillon" @click="compose.discard()" />
      </footer>
    </form>

    <!-- Attachment reminder dialog -->
    <AlertDialog v-model:open="attachmentReminderOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pièce jointe oubliée ?</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription>
          Votre message mentionne une pièce jointe, mais aucun fichier n'est joint.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Envoyer quand même</AlertDialogCancel>
          <AlertDialogAction @click="fileInput?.click()">
            Ajouter une pièce jointe
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
