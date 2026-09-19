<script setup lang="ts">
import type { Component } from 'vue'
import { cn } from '@/lib/utils'

/** Bouton icône accessible : libellé ARIA + infobulle, zone tactile ≥ 44 px sous 1024 px. */
// La racine est un Tooltip (sans élément DOM) : classes et attributs vont sur le bouton.
defineOptions({ inheritAttrs: false })
defineProps<{
  label: string
  icon: Component
  disabled?: boolean
  pressed?: boolean
}>()
defineEmits<{ click: [event: MouseEvent] }>()

const attrs = useAttrs()
const rest = computed(() => {
  const { class: _class, ...others } = attrs
  return others
})
const BASE = 'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 lg:size-10'
// tailwind-merge : une classe passée par l'appelant (ex. « hidden lg:inline-flex ») l'emporte sur la base.
const classes = computed(() => cn(BASE, attrs.class as string | undefined))
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        v-bind="rest"
        type="button"
        :aria-label="label"
        :aria-pressed="pressed"
        :disabled="disabled"
        :class="classes"
        @click="$emit('click', $event)"
      >
        <component :is="icon" class="size-5" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
