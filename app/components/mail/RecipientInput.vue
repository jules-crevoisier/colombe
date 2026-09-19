<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import { X, Users } from '@lucide/vue'
import type { Contact } from '#shared/types/mail'

/**
 * Champ destinataires en « puces » avec autocomplétion (motif ARIA combobox).
 * Entrée, virgule, point-virgule ou sortie du champ valident une adresse saisie.
 * Les groupes de contacts apparaissent dans la liste (« {nom} ({n} membres) ») ;
 * en choisir un ajoute une puce par membre (docs/dev/PLAN-v3.md R2.3 / R2.8).
 */
const props = defineProps<{ label: string; id: string; autofocus?: boolean }>()
const model = defineModel<string[]>({ required: true })
const emit = defineEmits<{ change: [] }>()

type Suggestion =
  | { kind: 'contact', contact: Contact }
  | { kind: 'group', id: number, name: string, emails: string[] }

const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
const suggestions = ref<Suggestion[]>([])
const active = ref(-1)
const open = computed(() => suggestions.value.length > 0)
const listId = computed(() => `${props.id}-suggestions`)
const contactsApi = useContactsApi()

watchDebounced(draft, async (q) => {
  const query = q.trim()
  if (!query || /[,;]/.test(query)) {
    suggestions.value = []
    return
  }
  try {
    const result = await contactsApi.searchWithGroups(query, 6)
    const taken = new Set(model.value.map(a => a.toLowerCase()))
    const contactSuggestions: Suggestion[] = result.contacts
      .filter(c => !taken.has(c.email.toLowerCase()))
      .map(contact => ({ kind: 'contact', contact }))
    const groupSuggestions: Suggestion[] = result.groups.map(g => ({ kind: 'group', id: g.id, name: g.name, emails: g.emails }))
    suggestions.value = [...groupSuggestions, ...contactSuggestions]
    active.value = suggestions.value.length ? 0 : -1
  }
  catch {
    suggestions.value = []
  }
}, { debounce: 200 })

function add(addresses: string[]) {
  const fresh = addresses.filter(a => !model.value.some(e => e.toLowerCase() === a.toLowerCase()))
  if (!fresh.length) return
  model.value = [...model.value, ...fresh]
  emit('change')
}

function commit() {
  const parsed = parseRecipientString(draft.value)
  draft.value = ''
  suggestions.value = []
  add(parsed)
}

function pick(suggestion: Suggestion) {
  draft.value = ''
  suggestions.value = []
  add(suggestion.kind === 'group' ? suggestion.emails : [suggestion.contact.email])
  input.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (open.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    const n = suggestions.value.length
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    return
  }
  if (open.value && e.key === 'Escape') {
    e.stopPropagation()
    suggestions.value = []
    return
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && open.value && active.value >= 0) {
    const choice = suggestions.value[active.value]
    if (choice) {
      e.preventDefault()
      pick(choice)
    }
    return
  }
  if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && draft.value.trim())) {
    if (draft.value.trim()) {
      e.preventDefault()
      commit()
    }
  }
  else if (e.key === 'Backspace' && !draft.value && model.value.length) {
    model.value = model.value.slice(0, -1)
    emit('change')
  }
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (/[,;\n]/.test(text)) {
    e.preventDefault()
    draft.value = text
    commit()
  }
}

function onBlur() {
  // Laisse le clic sur une suggestion aboutir avant de valider la saisie.
  setTimeout(() => {
    if (document.activeElement !== input.value) commit()
  }, 150)
}

function remove(i: number) {
  model.value = model.value.filter((_, idx) => idx !== i)
  emit('change')
  input.value?.focus()
}

defineExpose({ commit, focus: () => input.value?.focus() })

onMounted(() => {
  if (props.autofocus) input.value?.focus()
})
</script>

<template>
  <div class="relative flex min-h-12 flex-wrap items-center gap-1.5 border-b border-border py-1.5" @click="input?.focus()">
    <label :for="id" class="w-9 shrink-0 text-sm text-muted-foreground">{{ label }}</label>
    <span
      v-for="(addr, i) in model"
      :key="addr"
      class="inline-flex h-8 max-w-full items-center gap-1 rounded-md border pr-1 pl-2.5 text-sm"
      :class="validateEmailAddress(addr) ? 'border-border bg-secondary' : 'border-destructive bg-destructive/10 text-destructive'"
    >
      <span class="truncate">{{ addr }}</span>
      <span v-if="!validateEmailAddress(addr)" class="sr-only">(adresse invalide)</span>
      <button type="button" class="grid size-6 shrink-0 place-items-center rounded-sm hover:bg-foreground/10" :aria-label="`Retirer ${addr}`" @click.stop="remove(i)">
        <X class="size-3.5" aria-hidden="true" />
      </button>
    </span>
    <input
      :id="id"
      ref="input"
      v-model="draft"
      type="email"
      multiple
      role="combobox"
      :aria-expanded="open"
      :aria-controls="listId"
      aria-autocomplete="list"
      :aria-activedescendant="open && active >= 0 ? `${listId}-${active}` : undefined"
      autocomplete="off"
      inputmode="email"
      class="h-9 min-w-40 flex-1 bg-transparent text-base outline-none"
      @keydown="onKeydown"
      @blur="onBlur"
      @paste="onPaste"
    >
    <ul
      v-show="open"
      :id="listId"
      role="listbox"
      :aria-label="`Suggestions pour ${label}`"
      class="absolute top-full left-0 z-50 mt-1 w-full max-w-md overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-float"
    >
      <li
        v-for="(s, i) in suggestions"
        :id="`${listId}-${i}`"
        :key="s.kind === 'group' ? `group-${s.id}` : `contact-${s.contact.id}`"
        role="option"
        :aria-selected="i === active"
        class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5"
        :class="i === active ? 'bg-accent' : ''"
        @mousedown.prevent="pick(s)"
        @mouseenter="active = i"
      >
        <template v-if="s.kind === 'group'">
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
            <Users class="size-4" />
          </span>
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-sm font-medium">{{ s.name }} ({{ s.emails.length }} membre{{ s.emails.length > 1 ? 's' : '' }})</span>
          </span>
        </template>
        <template v-else>
          <span class="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" :class="getAvatarTone(s.contact.email)" aria-hidden="true">
            {{ getInitials(s.contact.name || s.contact.email.split('@')[0] || '?') }}
          </span>
          <span class="flex min-w-0 flex-col">
            <span v-if="s.contact.name" class="truncate text-sm font-medium">{{ s.contact.name }}</span>
            <span class="truncate text-xs text-muted-foreground">{{ s.contact.email }}</span>
          </span>
        </template>
      </li>
    </ul>
  </div>
</template>
