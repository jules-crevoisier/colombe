<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Quote, RemoveFormatting, Strikethrough, Underline } from '@lucide/vue'
import type { Component } from 'vue'

/**
 * Éditeur riche (TipTap). Ne produit que ce que le serveur accepte ensuite
 * (sanitizeOutgoingHtml) : gras, italique, souligné, barré, listes, citations,
 * liens http(s)/mailto. Pas d'images, pas de styles libres.
 */
const html = defineModel<string>('html', { required: true })
const emit = defineEmits<{ change: [text: string] }>()
const props = withDefaults(defineProps<{ id: string; label?: string; placeholder?: string }>(), {
  label: 'Message',
  placeholder: 'Rédigez votre message…',
})

const editor = useEditor({
  content: html.value,
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, protocols: ['mailto'], HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      codeBlock: false,
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
  ],
  editorProps: {
    attributes: {
      'class': 'prose-mail min-h-40 px-4 py-3 text-base leading-relaxed outline-none',
      'aria-label': props.label,
      'aria-multiline': 'true',
      'role': 'textbox',
      'spellcheck': 'true',
      'lang': 'fr',
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
    { label: 'Effacer la mise en forme', icon: RemoveFormatting, active: () => false, run: () => e.chain().focus().unsetAllMarks().clearNodes().run() },
  ]
})

defineExpose({
  focusStart: () => editor.value?.chain().focus('start').run(),
  insertAtStart: (content: string) => editor.value?.chain().focus('start').insertContent(content).run(),
})

onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto" @click="editor?.commands.focus()">
      <EditorContent :id="id" :editor="editor" />
    </div>
    <div role="toolbar" aria-label="Mise en forme" :aria-controls="id" class="flex shrink-0 gap-0.5 overflow-x-auto border-t border-border/60 px-2 py-1 [scrollbar-width:none]">
      <Tooltip v-for="tool in tools" :key="tool.label">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:size-8"
            :class="{ 'bg-nav-active text-nav-active-foreground': tool.active() }"
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
  </div>
</template>

<style>
.prose-mail p { margin: 0 0 .5em; }
.prose-mail ul { list-style: disc; padding-left: 1.5em; }
.prose-mail ol { list-style: decimal; padding-left: 1.5em; }
.prose-mail blockquote { border-left: 3px solid var(--border); padding-left: .75em; color: var(--muted-foreground); margin: .5em 0; }
.prose-mail a { color: var(--primary); text-decoration: underline; }
.prose-mail h2 { font-size: 1.25em; font-weight: 600; }
.prose-mail h3 { font-size: 1.1em; font-weight: 600; }
.prose-mail p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--muted-foreground); float: left; height: 0; pointer-events: none; }
</style>
