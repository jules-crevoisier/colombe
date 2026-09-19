<script setup lang="ts">
import { EditorContent, mergeAttributes, Node, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { toast } from 'vue-sonner'
import { Bold, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Quote, RemoveFormatting, Strikethrough, Underline } from '@lucide/vue'
import type { Component } from 'vue'

/**
 * Éditeur riche (TipTap). Ne produit que ce que le serveur accepte ensuite
 * (sanitizeOutgoingHtml) : gras, italique, souligné, barré, listes, citations,
 * liens http(s)/mailto, et des images `data:image/(png|jpeg|gif)` insérées
 * localement (docs/ROADMAP.md R2.1b). Pas de styles libres, jamais d'URL distante.
 *
 * `@tiptap/extension-image` n'est pas une dépendance du projet : on définit ici
 * un nœud minimal (via l'API `@tiptap/core`, ré-exportée par `@tiptap/vue-3`)
 * plutôt que d'ajouter une dépendance.
 */
const html = defineModel<string>('html', { required: true })
const emit = defineEmits<{ change: [text: string] }>()
const props = withDefaults(defineProps<{ id: string; label?: string; placeholder?: string; maxImages?: number }>(), {
  label: 'Message',
  placeholder: 'Rédigez votre message…',
  maxImages: undefined,
})

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif']
const MAX_IMAGE_BYTES = 200 * 1024

type ImageWidth = 'small' | 'medium' | 'original'
/** Attribut `width` (pixels) : conservé par l'assainissement serveur et respecté par Outlook. */
const WIDTHS: Record<ImageWidth, string | null> = {
  small: '160',
  medium: '320',
  original: null,
}
const WIDTH_OPTIONS: { value: ImageWidth; label: string }[] = [
  { value: 'small', label: 'Petite' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'original', label: 'Originale' },
]

const SAFE_IMAGE_SRC = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=\s]+$/

/** Image assainie, jamais distante : seule une source `data:image/(png|jpeg|gif)` est acceptée. */
const SafeImage = Node.create({
  name: 'safeImage',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const src = el.getAttribute('src') ?? ''
          return SAFE_IMAGE_SRC.test(src) ? src : null
        },
      },
      alt: { default: '' },
      // Jamais d'attribut `style` : un style collé (ex. background:url(…)) ferait charger
      // une ressource distante par l'éditeur. Largeur limitée aux valeurs proposées.
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const width = el.getAttribute('width')
          return width !== null && Object.values(WIDTHS).includes(width) ? width : null
        },
      },
    }
  },
  parseHTML() {
    return [{
      tag: 'img',
      // Toute image qui n'est pas une data: PNG/JPEG/GIF est ignorée au collage.
      getAttrs: (el: HTMLElement) => (SAFE_IMAGE_SRC.test(el.getAttribute('src') ?? '') ? null : false),
    }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'inline-block h-auto max-w-full' })]
  },
})

const imageFileInput = ref<HTMLInputElement | null>(null)
const imageDialogOpen = ref(false)
const pendingImage = ref<{ dataUrl: string } | null>(null)
const imageAlt = ref('')
const imageWidth = ref<ImageWidth>('original')

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'Formats acceptés pour une image : PNG, JPEG ou GIF.'
  if (file.size > MAX_IMAGE_BYTES) return 'Image trop lourde : 200 Ko maximum.'
  return null
}

function countImages(): number {
  const e = editor.value
  if (!e) return 0
  let count = 0
  e.state.doc.descendants((node) => {
    if (node.type.name === 'safeImage') count += 1
  })
  return count
}

function beginInsertImage(file: File) {
  const error = validateImageFile(file)
  if (error) {
    toast.error(error)
    return
  }
  if (props.maxImages != null && countImages() >= props.maxImages) {
    toast.error(`${props.maxImages} image${props.maxImages > 1 ? 's' : ''} maximum.`)
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    pendingImage.value = { dataUrl: String(reader.result) }
    imageAlt.value = ''
    imageWidth.value = 'original'
    imageDialogOpen.value = true
  }
  reader.onerror = () => toast.error('Impossible de lire cette image.')
  reader.readAsDataURL(file)
}

function onImageFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) beginInsertImage(file)
}

function confirmInsertImage() {
  const pending = pendingImage.value
  if (!pending) return
  editor.value?.chain().focus().insertContent({
    type: 'safeImage',
    attrs: { src: pending.dataUrl, alt: imageAlt.value.trim(), width: WIDTHS[imageWidth.value] },
  }).run()
  closeImageDialog()
}

function closeImageDialog() {
  imageDialogOpen.value = false
  pendingImage.value = null
}

const editor = useEditor({
  content: html.value,
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, protocols: ['mailto'], HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      codeBlock: false,
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
    SafeImage,
  ],
  editorProps: {
    attributes: {
      'class': 'prose-mail min-h-40 px-5 py-4 text-base leading-relaxed outline-none',
      'aria-label': props.label,
      'aria-multiline': 'true',
      'role': 'textbox',
      'spellcheck': 'true',
      'lang': 'fr',
    },
    handlePaste(_view, event) {
      const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'))
      if (!files.length) return false
      event.preventDefault()
      beginInsertImage(files[0]!)
      return true
    },
    handleDrop(_view, event) {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
      if (!files.length) return false
      event.preventDefault()
      beginInsertImage(files[0]!)
      return true
    },
  },
  onUpdate: ({ editor: e }) => {
    html.value = e.isEmpty ? '' : e.getHTML()
    emit('change', e.getText({ blockSeparator: '\n' }))
  },
})

// Contenu remplacé de l'extérieur (réponse, brouillon, signature) : on resynchronise.
watch(html, (value) => {
  const e = editor.value
  if (e && value !== e.getHTML() && !(value === '' && e.isEmpty)) e.commands.setContent(value, { emitUpdate: false })
})

function setLink() {
  const e = editor.value
  if (!e) return
  const previous = e.getAttributes('link').href as string | undefined
  const url = window.prompt('Adresse du lien (commençant par https ou mailto)', previous ?? 'https://')
  if (url === null) return
  if (!url.trim() || url.trim() === 'https://') {
    e.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) {
    window.alert('Seuls les liens http(s) et mailto sont autorisés.')
    return
  }
  e.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
}

interface Tool {
  label: string
  icon: Component
  active: () => boolean
  run: () => void
}

const tools = computed<Tool[]>(() => {
  const e = editor.value
  if (!e) return []
  return [
    { label: 'Gras (Ctrl+B)', icon: Bold, active: () => e.isActive('bold'), run: () => e.chain().focus().toggleBold().run() },
    { label: 'Italique (Ctrl+I)', icon: Italic, active: () => e.isActive('italic'), run: () => e.chain().focus().toggleItalic().run() },
    { label: 'Souligné (Ctrl+U)', icon: Underline, active: () => e.isActive('underline'), run: () => e.chain().focus().toggleUnderline().run() },
    { label: 'Barré', icon: Strikethrough, active: () => e.isActive('strike'), run: () => e.chain().focus().toggleStrike().run() },
    { label: 'Liste à puces', icon: List, active: () => e.isActive('bulletList'), run: () => e.chain().focus().toggleBulletList().run() },
    { label: 'Liste numérotée', icon: ListOrdered, active: () => e.isActive('orderedList'), run: () => e.chain().focus().toggleOrderedList().run() },
    { label: 'Citation', icon: Quote, active: () => e.isActive('blockquote'), run: () => e.chain().focus().toggleBlockquote().run() },
    { label: 'Lien', icon: LinkIcon, active: () => e.isActive('link'), run: setLink },
    { label: 'Insérer une image', icon: ImageIcon, active: () => false, run: () => imageFileInput.value?.click() },
    { label: 'Effacer la mise en forme', icon: RemoveFormatting, active: () => false, run: () => e.chain().focus().unsetAllMarks().clearNodes().run() },
  ]
})

defineExpose({
  focusStart: () => editor.value?.chain().focus('start').run(),
  focusEnd: () => editor.value?.chain().focus('end').run(),
  insertAtStart: (content: string) => editor.value?.chain().focus('start').insertContent(content).run(),
  insertAtCursor: (content: string) => editor.value?.chain().focus().insertContent(content).run(),
})

onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto" @click="editor?.commands.focus()">
      <EditorContent :id="id" :editor="editor" />
    </div>
    <div role="toolbar" aria-label="Mise en forme" :aria-controls="id" class="flex shrink-0 gap-0.5 overflow-x-auto border-t border-border px-3 py-1 [scrollbar-width:none]">
      <Tooltip v-for="tool in tools" :key="tool.label">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:size-8"
            :class="{ 'bg-primary/10 text-primary': tool.active() }"
            :aria-label="tool.label"
            :aria-pressed="tool.active()"
            @mousedown.prevent
            @click="tool.run()"
          >
            <component :is="tool.icon" class="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ tool.label }}</TooltipContent>
      </Tooltip>
    </div>

    <input
      ref="imageFileInput"
      type="file"
      accept="image/png,image/jpeg,image/gif"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      @change="onImageFileChange"
    >

    <Dialog :open="imageDialogOpen" @update:open="(v: boolean) => { if (!v) closeImageDialog() }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Insérer une image</DialogTitle>
          <DialogDescription>Formats PNG, JPEG ou GIF, 200 Ko maximum.</DialogDescription>
        </DialogHeader>
        <div v-if="pendingImage" class="flex flex-col gap-4">
          <img :src="pendingImage.dataUrl" alt="" class="max-h-40 w-full rounded-lg border border-border object-contain">
          <div class="flex flex-col gap-2">
            <Label for="image-alt-text">Texte alternatif</Label>
            <Input id="image-alt-text" v-model="imageAlt" class="h-11 text-base" placeholder="Décrivez l'image" />
          </div>
          <fieldset class="flex flex-col gap-1">
            <legend class="mb-1 text-sm font-medium">Largeur</legend>
            <label v-for="opt in WIDTH_OPTIONS" :key="opt.value" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-accent">
              <input v-model="imageWidth" type="radio" name="image-width" :value="opt.value" class="size-5 shrink-0 accent-[var(--primary)]">
              {{ opt.label }}
            </label>
          </fieldset>
        </div>
        <DialogFooter class="sm:justify-end">
          <Button variant="outline" @click="closeImageDialog">Annuler</Button>
          <Button @click="confirmInsertImage">Insérer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style>
.prose-mail p { margin: 0 0 .5em; }
.prose-mail ul { list-style: disc; padding-left: 1.5em; }
.prose-mail ol { list-style: decimal; padding-left: 1.5em; }
.prose-mail blockquote { border-left: 2px solid var(--line-strong); padding-left: .75em; color: var(--muted-foreground); margin: .5em 0; }
.prose-mail a { color: var(--primary); text-decoration: underline; }
.prose-mail h2 { font-family: var(--font-heading); font-size: 1.35em; font-weight: 500; }
.prose-mail h3 { font-family: var(--font-heading); font-size: 1.15em; font-weight: 500; }
.prose-mail img { border-radius: .375em; }
.prose-mail p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--muted-foreground); float: left; height: 0; pointer-events: none; }
</style>
