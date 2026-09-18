<script setup lang="ts">
import { CircleAlert, Forward, Paperclip, Reply, Star } from '@lucide/vue'
import type { MessageSummary } from '#shared/types/mail'

const props = defineProps<{
  message: MessageSummary
  to: string
  selected: boolean
  /** Envoyés / Brouillons : on affiche le destinataire plutôt que l'expéditeur. */
  showRecipient: boolean
  /** Brouillons : l'ouverture est gérée par le parent (éditeur), pas par la navigation. */
  interceptOpen?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ open: []; toggleSelect: []; toggleStar: []; dragstart: [event: DragEvent] }>()

const who = computed(() => (props.showRecipient ? props.message.to[0] : props.message.from) ?? null)
const person = computed(() => {
  const label = who.value ? (who.value.name || who.value.address) : '(inconnu)'
  return props.showRecipient ? `À : ${label}` : label
})
const initials = computed(() => getInitials(who.value?.name || who.value?.address.split('@')[0] || '?'))
const avatarColor = computed(() => getAvatarColorClass(who.value?.address ?? ''))
const date = computed(() => formatMessageDate(props.message.date, 'fr-FR'))
const fullDate = computed(() => new Date(props.message.date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }))
const weight = computed(() => (props.message.seen ? 'text-foreground/85' : 'font-bold text-foreground'))

function onLinkClick(e: MouseEvent) {
  if (!props.interceptOpen) return
  e.preventDefault()
  emit('open')
}
</script>

<template>
  <li
    class="group relative flex items-start gap-3 border-b border-border/60 px-3 transition-shadow hover:z-10 hover:shadow-md lg:items-center lg:gap-1 lg:py-0 lg:pr-4 lg:pl-2"
    :class="[selected ? 'bg-row-selected' : message.seen ? 'bg-row-read' : 'bg-surface-panel', compact ? 'py-2' : 'py-3']"
    :data-uid="message.uid"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
  >
    <!-- Mobile : l'avatar sert de case à cocher (comme Gmail) -->
    <button
      type="button"
      class="relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white lg:hidden"
      :class="selected ? 'bg-primary' : avatarColor"
      :aria-label="`${selected ? 'Désélectionner' : 'Sélectionner'} « ${message.subject} »`"
      :aria-pressed="selected"
      @click="emit('toggleSelect')"
    >
      <span aria-hidden="true">{{ selected ? '✓' : initials }}</span>
    </button>

    <!-- Bureau : case à cocher + étoile -->
    <label class="relative z-10 hidden size-10 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-accent lg:grid">
      <span class="sr-only">Sélectionner « {{ message.subject }} »</span>
      <Checkbox :model-value="selected" @update:model-value="emit('toggleSelect')" />
    </label>
    <button
      type="button"
      class="relative z-10 hidden size-10 shrink-0 place-items-center rounded-full hover:bg-accent lg:grid"
      :aria-label="message.flagged ? 'Retirer l’étoile' : 'Ajouter une étoile'"
      :aria-pressed="message.flagged"
      @click="emit('toggleStar')"
    >
      <Star class="size-5" :class="message.flagged ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'" aria-hidden="true" />
    </button>

    <div class="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-4" :class="compact ? 'lg:h-8' : 'lg:h-10'">
      <div class="flex items-baseline gap-2 lg:w-52 lg:shrink-0">
        <span class="min-w-0 flex-1 truncate" :class="weight">{{ person }}</span>
        <time class="shrink-0 text-xs lg:hidden" :class="message.seen ? 'text-muted-foreground' : 'font-bold text-primary'" :datetime="message.date" :title="fullDate">{{ date }}</time>
      </div>

      <div class="flex min-w-0 flex-1 items-start gap-2 lg:items-center">
        <NuxtLink
          :to="to"
          class="min-w-0 flex-1 text-sm outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring lg:truncate"
          @click="onLinkClick"
        >
          <span class="block truncate lg:inline" :class="weight">{{ message.subject }}</span>
          <span class="block truncate text-muted-foreground lg:inline"><span class="hidden lg:inline" aria-hidden="true"> — </span>{{ message.preview }}</span>
        </NuxtLink>

        <!-- Indicateurs : pièce jointe, répondu, transféré, priorité (libellés contractuels, docs/PLAN-v3.md) -->
        <div class="flex shrink-0 items-center gap-1">
          <Paperclip v-if="message.hasAttachments" class="mt-0.5 size-4 text-muted-foreground lg:mt-0" role="img" aria-label="Pièce jointe" />
          <Reply v-if="message.answered" class="size-4 text-muted-foreground" role="img" aria-label="Répondu" />
          <Forward v-if="message.forwarded" class="size-4 text-muted-foreground" role="img" aria-label="Transféré" />
          <CircleAlert v-if="message.priority === 'high'" class="size-4 text-destructive" role="img" aria-label="Priorité haute" />
        </div>
        <button
          type="button"
          class="relative z-10 -my-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-full lg:hidden"
          :aria-label="message.flagged ? 'Retirer l’étoile' : 'Ajouter une étoile'"
          :aria-pressed="message.flagged"
          @click="emit('toggleStar')"
        >
          <Star class="size-5" :class="message.flagged ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'" aria-hidden="true" />
        </button>
        <time class="hidden w-16 shrink-0 text-right text-xs lg:block" :class="message.seen ? 'text-muted-foreground' : 'font-bold text-foreground'" :datetime="message.date" :title="fullDate">{{ date }}</time>
      </div>
    </div>
  </li>
</template>

