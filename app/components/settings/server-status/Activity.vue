<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { MailActivity } from '#shared/types/server-status'
import { trafficBars } from '~/utils/server-status'

const props = defineProps<{ activity: MailActivity }>()

const { t, n } = useI18n()

const bars = computed(() => trafficBars(props.activity.heures))

const totals = computed(() => {
  const t24 = props.activity.totaux_24h
  return [
    { key: 'submitted', value: t24.soumis },
    { key: 'received', value: t24.recu },
    { key: 'deliveredLocal', value: t24.livre_local },
    { key: 'deliveredExternal', value: t24.livre_externe },
    { key: 'deferred', value: t24.differe },
    { key: 'bounced', value: t24.rejete },
    { key: 'rejectedIncoming', value: t24.rejet_entrant },
    { key: 'quota', value: t24.quota },
    { key: 'spoofing', value: t24.usurpation },
  ]
})

/** Une étiquette d'heure sur six : assez d'air à 320 px. */
function showLabel(index: number): boolean {
  return index % 6 === 0
}
</script>

<template>
  <div class="space-y-6">
    <p v-if="!bars.length" class="text-[15px] text-muted-foreground">{{ t('serverStatus.activity.empty') }}</p>

    <template v-else>
      <div class="space-y-2">
        <ul class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <li class="flex items-center gap-2">
            <span class="size-3 rounded-sm bg-chart-2" aria-hidden="true" />
            {{ t('serverStatus.activity.legendAccepted') }}
          </li>
          <li class="flex items-center gap-2">
            <span class="size-3 rounded-sm bg-beak-strong" aria-hidden="true" />
            {{ t('serverStatus.activity.legendRefused') }}
          </li>
        </ul>

        <!-- Graphique décoratif : les mêmes données sont dans le tableau ci-dessous. -->
        <div aria-hidden="true">
          <div class="flex h-32 items-end gap-0.5 border-b border-border">
            <div v-for="bar in bars" :key="bar.debut" class="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div class="bg-beak-strong" :class="bar.refus > 0 ? 'min-h-0.5' : ''" :style="{ height: `${bar.refusPct}%` }" />
              <div class="bg-chart-2" :class="bar.acceptes > 0 ? 'min-h-0.5' : ''" :style="{ height: `${bar.acceptesPct}%` }" />
            </div>
          </div>
          <div class="mt-1 flex gap-0.5 text-xs text-muted-foreground tabular-nums">
            <span v-for="(bar, i) in bars" :key="bar.debut" class="min-w-0 flex-1 whitespace-nowrap">{{ showLabel(i) ? bar.heure : '' }}</span>
          </div>
        </div>
      </div>

      <dl class="divide-y divide-border">
        <div v-for="row in totals" :key="row.key" class="flex items-baseline justify-between gap-4 py-2">
          <dt class="text-sm text-muted-foreground">{{ t(`serverStatus.activity.${row.key}`) }}</dt>
          <dd class="text-[15px] font-medium tabular-nums">{{ n(row.value) }}</dd>
        </div>
      </dl>

      <details>
        <summary class="flex min-h-11 cursor-pointer list-none items-center text-[15px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          {{ t('serverStatus.activity.tableSummary') }}
        </summary>
        <table class="mt-2 w-full text-left text-sm tabular-nums">
          <caption class="sr-only">{{ t('serverStatus.activity.tableCaption') }}</caption>
          <thead>
            <tr class="border-b border-border text-muted-foreground">
              <th scope="col" class="py-2 pr-2 font-medium">{{ t('serverStatus.activity.hour') }}</th>
              <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('serverStatus.activity.accepted') }}</th>
              <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('serverStatus.activity.refused') }}</th>
              <th scope="col" class="py-2 pl-2 text-right font-medium">{{ t('serverStatus.activity.total') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="bar in bars" :key="bar.debut">
              <th scope="row" class="py-2 pr-2 font-normal">
                <time :datetime="bar.debut">{{ bar.heure }}</time>
              </th>
              <td class="px-2 py-2 text-right">{{ n(bar.acceptes) }}</td>
              <td class="px-2 py-2 text-right">{{ n(bar.refus) }}</td>
              <td class="py-2 pl-2 text-right font-medium">{{ n(bar.total) }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
  </div>
</template>
