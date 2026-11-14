<script setup lang="ts">
import { CircleCheck, CircleX, Info, TriangleAlert } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { ServerVerdict } from '#shared/types/server-status'

/**
 * Ton de statut : icône + mot, jamais la couleur seule.
 * « neutral » : information sans enjeu (le libellé est alors obligatoire).
 */
const props = withDefaults(defineProps<{
  tone: ServerVerdict | 'neutral'
  /** Remplace le mot du ton (« Sain », « À surveiller », « En panne »). */
  label?: string
  size?: 'md' | 'lg'
}>(), { label: undefined, size: 'md' })

const { t } = useI18n()

const ICONS = { ok: CircleCheck, attention: TriangleAlert, panne: CircleX, neutral: Info } as const

const TEXT_CLASSES = {
  ok: 'text-chart-2',
  attention: 'text-beak-strong',
  panne: 'text-destructive',
  neutral: 'text-muted-foreground',
} as const

const icon = computed(() => ICONS[props.tone])
const word = computed(() => props.label ?? (props.tone === 'neutral' ? '' : t(`serverStatus.tone.${props.tone}`)))
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-2 font-medium',
      TEXT_CLASSES[tone],
      size === 'lg' ? 'font-heading text-3xl leading-tight sm:text-4xl' : 'text-sm',
    ]"
  >
    <component :is="icon" :class="['shrink-0', size === 'lg' ? 'size-7 sm:size-9' : 'size-4']" aria-hidden="true" />
    <span>{{ word }}</span>
  </span>
</template>
