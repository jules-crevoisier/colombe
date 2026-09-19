<script setup lang="ts">
import type { GuideStep } from '~/utils/devices'

const props = defineProps<{
  steps: GuideStep[]
}>()

const items = computed(() => props.steps.map(step => ({ ...step, parts: splitQuoted(step.text) })))
</script>

<template>
  <ol class="space-y-4">
    <li v-for="(step, i) in items" :key="i" class="flex gap-3">
      <span class="mt-px grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-panel text-xs font-semibold tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
      <div class="min-w-0 flex-1 space-y-2">
        <p class="text-[15px] leading-relaxed">
          <template v-for="(part, j) in step.parts" :key="j">
            <span v-if="part.quoted" class="font-medium">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </p>
        <dl v-if="step.values?.length" class="divide-y divide-border rounded-lg border border-border bg-surface-panel">
          <div v-for="v in step.values" :key="v.label" class="relative flex min-h-11 flex-wrap items-baseline gap-x-3 py-2 pr-14 pl-3">
            <dt class="text-xs text-muted-foreground sm:w-36 sm:shrink-0 sm:text-sm">{{ v.label }}</dt>
            <dd class="min-w-0 font-mono text-[15px] break-all">
              {{ v.value }}
              <SettingsDevicesCopyButton :value="v.value" :label="`« ${v.label} » (${v.value})`" class="absolute top-1/2 right-0.5 -translate-y-1/2" />
            </dd>
          </div>
        </dl>
      </div>
    </li>
  </ol>
</template>
