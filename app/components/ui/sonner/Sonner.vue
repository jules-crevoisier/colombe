<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { Toaster as Sonner } from 'vue-sonner'
import { cn } from '@/lib/utils'

// Identité « Pli » : un bordereau imprimé à l'encre (encre sur papier ; papier sur nuit).
const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, 'class', 'toastOptions')
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--foreground)',
      '--normal-text': 'var(--background)',
      '--normal-border': 'var(--foreground)',
      '--success-bg': 'var(--foreground)',
      '--success-text': 'var(--background)',
      '--success-border': 'var(--foreground)',
      '--info-bg': 'var(--foreground)',
      '--info-text': 'var(--background)',
      '--info-border': 'var(--foreground)',
      '--warning-bg': 'var(--foreground)',
      '--warning-text': 'var(--background)',
      '--warning-border': 'var(--foreground)',
      '--error-bg': 'var(--destructive)',
      '--error-text': 'var(--destructive-foreground)',
      '--error-border': 'var(--destructive)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'var(--foreground)',
      '--gray3': 'var(--foreground)',
      '--gray4': 'var(--foreground)',
      '--gray5': 'var(--foreground)',
      '--gray12': 'var(--background)',
    }"
    :toast-options="props.toastOptions ?? {
      classes: {
        toast: 'rounded-lg font-sans shadow-float',
        actionButton: '!bg-beak !text-beak-foreground !font-semibold !rounded-md !h-10 !px-3.5',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
