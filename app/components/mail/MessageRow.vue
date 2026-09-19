<script setup lang="ts">
import { Check, CircleAlert, Forward, Paperclip, Reply, Star } from '@lucide/vue'
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
const avatarTone = computed(() => getAvatarTone(who.value?.address ?? ''))
const prefsStore = usePrefsStore()
const dateOpts = computed(() => ({ timeZone: prefsStore.prefs.timeZone, dateFormat: prefsStore.prefs.dateFormat, timeFormat: prefsStore.prefs.timeFormat }))
const date = computed(() => formatMessageDate(props.message.date, 'fr-FR', dateOpts.value))
const fullDate = computed(() => formatFullDate(props.message.date, 'fr-FR', dateOpts.value))
// Non lu : graisse (hiérarchie par la typographie, pas par un fond coloré).
const weight = computed(() => (props.message.seen ? 'text-foreground/80' : 'font-bold text-foreground'))

/*
 * Mise en page pilotée par la largeur de la liste (requêtes de conteneur, @container posé
 * par MessageList) : deux niveaux (expéditeur + date / objet / extrait) quand la liste est
 * étroite — mobile, volet de lecture à droite — et une ligne à colonnes fixes sinon.
 */
function onLinkClick(e: MouseEvent) {
  if (!props.interceptOpen) return
  e.preventDefault()
  emit('open')
}
</script>

<template>
  <li
    class="group/row relative flex items-start gap-3 border-b border-border px-3 transition-colors duration-150 @3xl:items-center @3xl:gap-1 @3xl:py-0 lg:pr-4 lg:pl-2"
    :class="[selected ? 'bg-row-selected' : 'bg-row-read hover:bg-row-hover', compact ? 'py-2' : 'py-3']"
    :data-uid="message.uid"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
  >
    <!-- Non lu : un point d'encre dans la marge -->
    <span v-if="!message.seen" class="absolute top-[1.45rem] left-[3px] size-1.5 rounded-full bg-unread-dot @3xl:top-1/2 @3xl:-translate-y-1/2" aria-hidden="true" />

    <!-- Mobile : l'avatar sert de case à cocher -->
    <button
      type="button"
      class="relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white transition-transform duration-150 active:scale-95 lg:hidden"
      :class="selected ? 'bg-primary text-primary-foreground' : avatarTone"
      :aria-label="`${selected ? 'Désélectionner' : 'Sélectionner'} « ${message.subject} »`"
      :aria-pressed="selected"
      @click="emit('toggleSelect')"
    >
      <Check v-if="selected" class="size-5" :stroke-width="2.5" aria-hidden="true" />
      <span v-else aria-hidden="true">{{ initials }}</span>
    </button>

    <!-- Bureau : case à cocher + étoile -->
    <label class="relative z-10 hidden size-10 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-foreground/[0.06] lg:grid">
      <span class="sr-only">Sélectionner « {{ message.subject }} »</span>
      <Checkbox :model-value="selected" @update:model-value="emit('toggleSelect')" />
    </label>
    <button
      type="button"
      class="relative z-10 hidden size-10 shrink-0 place-items-center rounded-lg hover:bg-foreground/[0.06] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:grid"
      :aria-label="message.flagged ? 'Retirer l’étoile' : 'Ajouter une étoile'"
      :aria-pressed="message.flagged"
      @click="emit('toggleStar')"
    >
      <Star class="size-[18px] transition-colors" :class="message.flagged ? 'fill-beak text-beak-strong' : 'text-muted-foreground'" aria-hidden="true" />
    </button>

    <div class="flex min-w-0 flex-1 flex-col gap-0.5 @3xl:flex-row @3xl:items-center @3xl:gap-4" :class="compact ? '@3xl:h-9' : '@3xl:h-11'">
      <div class="flex items-baseline gap-2 @3xl:w-48 @3xl:shrink-0 @5xl:w-56">
        <span class="min-w-0 flex-1 truncate text-[15px] @3xl:text-sm" :class="weight">{{ person }}</span>
        <time class="shrink-0 text-xs tabular-nums @3xl:hidden" :class="message.seen ? 'text-muted-foreground' : 'font-semibold text-primary'" :datetime="message.date" :title="fullDate">{{ date }}</time>
      </div>

      <div class="flex min-w-0 flex-1 items-start gap-2 @3xl:items-center">
        <NuxtLink
          :to="to"
          class="min-w-0 flex-1 text-sm outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring @3xl:truncate"
          @click="onLinkClick"
        >
          <span class="block truncate @3xl:inline" :class="weight">{{ message.subject }}</span>
          <span class="block truncate text-muted-foreground @3xl:inline"><span class="hidden @3xl:inline" aria-hidden="true"> — </span>{{ message.preview }}</span>
        </NuxtLink>

        <!-- Indicateurs : pièce jointe, répondu, transféré, priorité (libellés contractuels, docs/dev/PLAN-v3.md) -->
        <div class="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <Paperclip v-if="message.hasAttachments" class="mt-0.5 size-4 @3xl:mt-0" role="img" aria-label="Pièce jointe" />
          <Reply v-if="message.answered" class="size-4" role="img" aria-label="Répondu" />
          <Forward v-if="message.forwarded" class="size-4" role="img" aria-label="Transféré" />
          <CircleAlert v-if="message.priority === 'high'" class="size-4 text-destructive" role="img" aria-label="Priorité haute" />
        </div>
        <button
          type="button"
          class="relative z-10 -my-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-lg lg:hidden"
          :aria-label="message.flagged ? 'Retirer l’étoile' : 'Ajouter une étoile'"
          :aria-pressed="message.flagged"
          @click="emit('toggleStar')"
        >
          <Star class="size-5" :class="message.flagged ? 'fill-beak text-beak-strong' : 'text-muted-foreground'" aria-hidden="true" />
        </button>
        <time class="hidden w-16 shrink-0 text-right text-xs tabular-nums @3xl:block" :class="message.seen ? 'text-muted-foreground' : 'font-semibold text-foreground'" :datetime="message.date" :title="fullDate">{{ date }}</time>
      </div>
    </div>
  </li>
</template>
