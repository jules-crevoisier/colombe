<script setup lang="ts">
import { RotateCw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { Blocklist, ServerEventLevel, ServerStatus, ServerVerdict } from '#shared/types/server-status'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { certificateTone, diskTone, relativeAge, serviceTone, statusFreshness } from '~/utils/server-status'
import { statusOf } from '~/utils/errors'

const { t, n, locale } = useI18n()
const api = useServerStatusApi()

type ErrorKind = 'generic' | 'forbidden' | 'notFound' | 'unavailable'

const loading = ref(true)
const refreshing = ref(false)
const errorKind = ref<ErrorKind | null>(null)
const status = ref<ServerStatus | null>(null)
const now = ref(Date.now())

async function load(initial: boolean): Promise<void> {
  if (initial) loading.value = true
  else refreshing.value = true
  errorKind.value = null
  try {
    const response = await api.status()
    now.value = Date.now()
    if (response.available) {
      status.value = response.status
    }
    else {
      // Relevé illisible ou absent : on garde le précédent, signalé comme ancien.
      errorKind.value = 'unavailable'
    }
  }
  catch (err) {
    const code = statusOf(err)
    // Accès retiré (403) ou page désactivée (404) : plus rien à montrer.
    if (code === 403 || code === 404) status.value = null
    errorKind.value = code === 403 ? 'forbidden' : code === 404 ? 'notFound' : 'generic'
  }
  finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(() => {
  void load(true)
})

const freshness = computed(() => (status.value ? statusFreshness(status.value.genere_le, status.value.intervalle_minutes, now.value) : null))

const staleMessage = computed(() => {
  const f = freshness.value
  if (!f?.stale) return ''
  if (f.ageMinutes === null || !status.value) return t('serverStatus.staleUnknown')
  return t('serverStatus.stale', { age: relativeAge(status.value.genere_le, now.value, locale.value) })
})

const freshnessLine = computed(() => {
  const s = status.value
  if (!s) return ''
  return t('serverStatus.freshness', {
    age: relativeAge(s.genere_le, now.value, locale.value),
    server: s.serveur,
    n: s.intervalle_minutes,
  })
})

/** Le champ peut contenir une simple date ISO ou le texte du rapport. */
const reportIsDate = computed(() => {
  const report = status.value?.dernier_rapport
  return !!report && !report.includes('\n') && !Number.isNaN(Date.parse(report))
})

function age(iso: string): string {
  return relativeAge(iso, now.value, locale.value)
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(locale.value, { dateStyle: 'long' })
}

const EVENT_TONES: Record<ServerEventLevel, ServerVerdict | 'neutral'> = {
  info: 'neutral',
  attention: 'attention',
  critique: 'panne',
}

function blocklistTone(list: Blocklist): ServerVerdict | 'neutral' {
  if (list.statut === 'propre') return 'ok'
  if (list.statut === 'listee') return 'panne'
  return 'neutral'
}

function blocklistLabel(list: Blocklist): string {
  if (list.statut === 'propre') return t('serverStatus.deliverability.clean')
  if (list.statut === 'listee') return list.code ? t('serverStatus.deliverability.listedCode', { code: list.code }) : t('serverStatus.deliverability.listed')
  return t('serverStatus.deliverability.unknown')
}

function certificateLabel(jours: number | null): string {
  if (jours === null) return t('serverStatus.system.expiresUnknown')
  if (jours <= 0) return t('serverStatus.system.expired')
  return t('serverStatus.system.days', { n: jours }, jours)
}
</script>

<template>
  <div class="space-y-8">
    <p class="max-w-prose text-[15px] leading-relaxed text-muted-foreground">{{ t('serverStatus.intro') }}</p>

    <!-- Chargement -->
    <div v-if="loading" class="space-y-4" role="status" aria-busy="true" :aria-label="t('serverStatus.loadingAriaLabel')">
      <Skeleton class="h-28 w-full" />
      <Skeleton class="h-6 w-1/2" />
      <Skeleton class="h-40 w-full" />
    </div>

    <!-- Erreur ou état indisponible -->
    <div v-else-if="errorKind && !status" role="alert" class="space-y-3 rounded-lg border border-border bg-card p-4">
      <p class="text-[15px]">
        {{ errorKind === 'generic' ? t('serverStatus.error.message') : t(`serverStatus.error.${errorKind}`) }}
      </p>
      <Button v-if="errorKind !== 'forbidden'" variant="outline" class="h-11 rounded-lg px-4" :disabled="refreshing" @click="load(true)">
        <RotateCw class="size-4" aria-hidden="true" />
        {{ t('common.retry') }}
      </Button>
    </div>

    <template v-else-if="status">
      <!-- Verdict : une seule surface -->
      <header class="space-y-3 rounded-lg border border-border bg-surface-panel p-4 sm:p-6">
        <SettingsServerStatusTone :tone="status.global" :label="t(`serverStatus.verdict.${status.global}`)" size="lg" />
        <p class="text-sm text-muted-foreground tabular-nums">{{ freshnessLine }}</p>
        <p v-if="staleMessage" role="alert" class="text-sm font-medium text-beak-strong">{{ staleMessage }}</p>
        <p v-if="errorKind" role="alert" class="text-sm font-medium text-destructive">{{ t('serverStatus.refreshFailed') }}</p>
        <Button variant="outline" class="h-11 rounded-lg px-4" :disabled="refreshing" :aria-busy="refreshing" @click="load(false)">
          <RotateCw class="size-4" :class="refreshing ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
          {{ refreshing ? t('serverStatus.refreshing') : t('serverStatus.refresh') }}
        </Button>
      </header>

      <!-- Points d'attention -->
      <SettingsServerStatusSection id="attention" :title="t('serverStatus.attention.title')">
        <p v-if="!status.points_attention.length" class="text-[15px] text-muted-foreground">{{ t('serverStatus.attention.none') }}</p>
        <ul v-else class="divide-y divide-border">
          <li v-for="(point, i) in status.points_attention" :key="i" class="py-3 text-[15px] leading-relaxed">{{ point }}</li>
        </ul>
      </SettingsServerStatusSection>

      <!-- Services -->
      <SettingsServerStatusSection id="services" :title="t('serverStatus.services.title')">
        <p v-if="!status.services.length" class="text-[15px] text-muted-foreground">{{ t('serverStatus.services.empty') }}</p>
        <ul v-else class="divide-y divide-border">
          <li v-for="service in status.services" :key="service.id" class="space-y-2 py-4">
            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p class="font-medium">{{ service.nom }}</p>
              <SettingsServerStatusTone :tone="serviceTone(service)" />
            </div>
            <p class="text-sm text-muted-foreground">{{ service.role }}</p>
            <p class="text-sm text-muted-foreground tabular-nums">
              {{ service.actif && service.depuis ? t('serverStatus.services.since', { age: age(service.depuis) }) : t('serverStatus.services.stopped') }}
              · {{ t('serverStatus.services.restarts', { n: service.relances_24h }, service.relances_24h) }}
            </p>
            <p v-if="service.relance" class="text-sm text-muted-foreground">{{ t(`serverStatus.services.restartResult.${service.relance}`) }}</p>
            <p v-if="!service.tests.length" class="text-sm text-muted-foreground">{{ t('serverStatus.services.noProbes') }}</p>
            <ul v-else class="space-y-1" :aria-label="t('serverStatus.services.probes')">
              <li v-for="probe in service.tests" :key="probe.nom" class="flex flex-wrap items-baseline gap-x-2 text-sm">
                <SettingsServerStatusTone :tone="probe.ok ? 'ok' : 'attention'" :label="probe.ok ? t('serverStatus.services.probeOk') : t('serverStatus.services.probeFail')" />
                <span class="font-medium">{{ probe.nom }}</span>
                <span class="break-words text-muted-foreground">{{ probe.detail }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </SettingsServerStatusSection>

      <!-- Activité -->
      <SettingsServerStatusSection id="activity" :title="t('serverStatus.activity.title')" :unavailable="!status.activite">
        <SettingsServerStatusActivity v-if="status.activite" :activity="status.activite" />
      </SettingsServerStatusSection>

      <!-- File d'attente -->
      <SettingsServerStatusSection id="queue" :title="t('serverStatus.queue.title')" :unavailable="!status.file">
        <template v-if="status.file">
          <p v-if="status.file.total === 0" class="text-[15px] text-muted-foreground">{{ t('serverStatus.queue.empty') }}</p>
          <template v-else>
            <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SettingsServerStatusStat :label="t('serverStatus.queue.total')" :value="n(status.file.total)" />
              <SettingsServerStatusStat :label="t('serverStatus.queue.active')" :value="n(status.file.actifs)" />
              <SettingsServerStatusStat :label="t('serverStatus.queue.deferred')" :value="n(status.file.differes)" />
              <SettingsServerStatusStat :label="t('serverStatus.queue.held')" :value="n(status.file.mis_de_cote)" />
              <SettingsServerStatusStat
                v-if="status.file.plus_ancien_minutes !== null"
                :label="t('serverStatus.queue.oldest')"
                :value="t('serverStatus.queue.oldestValue', { n: n(status.file.plus_ancien_minutes) })"
              />
            </dl>
            <div v-if="status.file.expediteurs.length" class="space-y-1">
              <h4 class="text-sm font-medium">{{ t('serverStatus.queue.senders') }}</h4>
              <ul class="divide-y divide-border">
                <li v-for="sender in status.file.expediteurs" :key="sender.adresse" class="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span class="min-w-0 break-all">{{ sender.adresse }}</span>
                  <span class="tabular-nums">{{ n(sender.n) }}</span>
                </li>
              </ul>
            </div>
            <div v-if="status.file.raisons.length" class="space-y-1">
              <h4 class="text-sm font-medium">{{ t('serverStatus.queue.reasons') }}</h4>
              <ul class="divide-y divide-border">
                <li v-for="reason in status.file.raisons" :key="reason.raison" class="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span class="min-w-0 break-words">{{ reason.raison }}</span>
                  <span class="tabular-nums">{{ n(reason.n) }}</span>
                </li>
              </ul>
            </div>
          </template>
        </template>
      </SettingsServerStatusSection>

      <!-- Comptes -->
      <SettingsServerStatusSection id="accounts" :title="t('serverStatus.accounts.title')" :unavailable="!status.comptes">
        <template v-if="status.comptes">
          <dl class="grid grid-cols-3 gap-4">
            <SettingsServerStatusStat :label="t('serverStatus.accounts.total')" :value="n(status.comptes.total)" />
            <SettingsServerStatusStat :label="t('serverStatus.accounts.active')" :value="n(status.comptes.actifs)" />
            <SettingsServerStatusStat :label="t('serverStatus.accounts.blocked')" :value="n(status.comptes.bloques)" />
          </dl>
          <div class="space-y-1">
            <h4 class="text-sm font-medium">{{ t('serverStatus.accounts.recent') }}</h4>
            <p v-if="!status.comptes.bloques_recemment.length" class="text-sm text-muted-foreground">{{ t('serverStatus.accounts.noRecent') }}</p>
            <ul v-else class="divide-y divide-border">
              <li v-for="block in status.comptes.bloques_recemment" :key="`${block.le}-${block.message}`" class="space-y-0.5 py-2 text-sm">
                <p class="text-muted-foreground tabular-nums">{{ formatDate(block.le) }}</p>
                <p class="break-words">{{ block.message }}</p>
              </li>
            </ul>
          </div>
        </template>
      </SettingsServerStatusSection>

      <!-- Délivrabilité -->
      <SettingsServerStatusSection id="deliverability" :title="t('serverStatus.deliverability.title')" :unavailable="!status.delivrabilite">
        <template v-if="status.delivrabilite">
          <p v-if="status.delivrabilite.verifie_le" class="text-sm text-muted-foreground">
            {{ t('serverStatus.deliverability.checked', { age: age(status.delivrabilite.verifie_le) }) }}
          </p>
          <dl class="divide-y divide-border">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <dt class="text-sm text-muted-foreground">{{ t('serverStatus.deliverability.domain') }}</dt>
              <dd class="text-[15px] break-all">{{ status.delivrabilite.domaine }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <dt class="text-sm text-muted-foreground">{{ t('serverStatus.deliverability.ip') }}</dt>
              <dd class="text-[15px] tabular-nums">{{ status.delivrabilite.ip }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <dt class="text-sm text-muted-foreground">{{ t('serverStatus.deliverability.ptr') }}</dt>
              <dd class="text-[15px] break-all">{{ status.delivrabilite.ptr ?? t('serverStatus.deliverability.missing') }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <dt class="text-sm text-muted-foreground">{{ t('serverStatus.deliverability.spf') }}</dt>
              <dd class="min-w-0 text-[15px] break-all">{{ status.delivrabilite.spf ?? t('serverStatus.deliverability.missing') }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <dt class="text-sm text-muted-foreground">{{ t('serverStatus.deliverability.dmarc') }}</dt>
              <dd class="min-w-0 text-[15px] break-all">{{ status.delivrabilite.dmarc ?? t('serverStatus.deliverability.missing') }}</dd>
            </div>
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
              <dt class="text-sm text-muted-foreground">{{ t('serverStatus.deliverability.dkim') }}</dt>
              <dd class="text-[15px]">
                <SettingsServerStatusTone
                  :tone="status.delivrabilite.dkim ? 'ok' : 'attention'"
                  :label="status.delivrabilite.dkim ? t('serverStatus.deliverability.dkimPresent') : t('serverStatus.deliverability.dkimAbsent')"
                />
                <span v-if="status.delivrabilite.dkim_selecteur" class="ml-2 text-sm text-muted-foreground">
                  {{ t('serverStatus.deliverability.dkimSelector', { selector: status.delivrabilite.dkim_selecteur }) }}
                </span>
              </dd>
            </div>
          </dl>
          <div class="space-y-1">
            <h4 class="text-sm font-medium">{{ t('serverStatus.deliverability.blocklists') }}</h4>
            <ul class="divide-y divide-border">
              <li v-for="list in status.delivrabilite.listes" :key="list.nom" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span class="min-w-0 break-all">{{ list.nom }}</span>
                <SettingsServerStatusTone :tone="blocklistTone(list)" :label="blocklistLabel(list)" />
              </li>
            </ul>
          </div>
        </template>
      </SettingsServerStatusSection>

      <!-- Protection -->
      <SettingsServerStatusSection id="protection" :title="t('serverStatus.protection.title')" :unavailable="!status.fail2ban">
        <template v-if="status.fail2ban">
          <p v-if="!status.fail2ban.jails.length" class="text-[15px] text-muted-foreground">{{ t('serverStatus.protection.noJails') }}</p>
          <template v-else>
            <dl>
              <SettingsServerStatusStat :label="t('serverStatus.protection.banned')" :value="n(status.fail2ban.bannis)" />
            </dl>
            <ul class="divide-y divide-border">
              <li v-for="jail in status.fail2ban.jails" :key="jail.nom" class="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
                <span class="font-medium">{{ jail.nom }}</span>
                <span class="text-muted-foreground tabular-nums">{{ t('serverStatus.protection.jail', { banned: n(jail.bannis), total: n(jail.total) }) }}</span>
              </li>
            </ul>
          </template>
        </template>
      </SettingsServerStatusSection>

      <!-- Système -->
      <SettingsServerStatusSection id="system" :title="t('serverStatus.system.title')" :unavailable="!status.systeme">
        <template v-if="status.systeme">
          <div class="space-y-1">
            <h4 class="text-sm font-medium">{{ t('serverStatus.system.disks') }}</h4>
            <p v-if="!status.systeme.disques.length" class="text-sm text-muted-foreground">{{ t('serverStatus.system.noDisks') }}</p>
            <ul v-else class="divide-y divide-border">
              <li v-for="disk in status.systeme.disques" :key="disk.point" class="space-y-1 py-2 text-sm">
                <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span class="min-w-0 font-medium break-all">{{ disk.point }}</span>
                  <SettingsServerStatusTone :tone="diskTone(disk.pourcent)" :label="`${n(disk.pourcent)} %`" />
                </div>
                <p class="text-muted-foreground tabular-nums">{{ t('serverStatus.system.free', { n: n(disk.libre_go) }) }}</p>
              </li>
            </ul>
          </div>
          <div class="space-y-1">
            <h4 class="text-sm font-medium">{{ t('serverStatus.system.certificate') }}</h4>
            <p v-if="!status.systeme.certificat" class="text-sm text-muted-foreground">{{ t('serverStatus.system.noCertificate') }}</p>
            <div v-else class="space-y-1 text-sm">
              <SettingsServerStatusTone :tone="certificateTone(status.systeme.certificat.jours)" :label="certificateLabel(status.systeme.certificat.jours)" />
              <p v-if="status.systeme.certificat.expire_le" class="text-muted-foreground tabular-nums">
                {{ t('serverStatus.system.expires', { date: formatDay(status.systeme.certificat.expire_le) }) }}
              </p>
              <p class="break-all text-muted-foreground">{{ status.systeme.certificat.fichier }}</p>
            </div>
          </div>
        </template>
      </SettingsServerStatusSection>

      <!-- Événements -->
      <SettingsServerStatusSection id="events" :title="t('serverStatus.events.title')">
        <p v-if="!status.evenements.length" class="text-[15px] text-muted-foreground">{{ t('serverStatus.events.empty') }}</p>
        <ul v-else class="divide-y divide-border">
          <li v-for="event in status.evenements" :key="`${event.ts}-${event.type}-${event.message}`" class="space-y-1 py-3 text-sm">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SettingsServerStatusTone :tone="EVENT_TONES[event.niveau]" :label="t(`serverStatus.events.level.${event.niveau}`)" />
              <span class="text-muted-foreground tabular-nums">{{ formatDate(event.t) }}</span>
              <span class="text-muted-foreground">{{ event.type }}</span>
            </div>
            <p class="text-[15px] leading-relaxed break-words">{{ event.message }}</p>
          </li>
        </ul>
      </SettingsServerStatusSection>

      <!-- Dernier rapport quotidien : le script n'écrit que sa date ; un texte complet reste dépliable. -->
      <p v-if="status.dernier_rapport && reportIsDate" class="border-t border-border pt-4 text-sm text-muted-foreground tabular-nums">
        {{ t('serverStatus.report.lastSent', { date: formatDate(status.dernier_rapport) }) }}
      </p>
      <details v-else-if="status.dernier_rapport" class="border-t border-border pt-2">
        <summary class="flex min-h-11 cursor-pointer list-none items-center text-[15px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          {{ t('serverStatus.report.summary') }}
        </summary>
        <pre class="mt-2 max-w-full overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap">{{ status.dernier_rapport }}</pre>
      </details>
    </template>
  </div>
</template>
