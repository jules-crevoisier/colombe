<script setup lang="ts">
import { ArrowDownToLine, ArrowUpFromLine } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { ReadyDeviceSettings } from '~/utils/devices'

const { t } = useI18n()

const props = defineProps<{
  settings: ReadyDeviceSettings
}>()

// Le tableau peut figurer deux fois sur la page (en haut et dans « Autre application ») : identifiants uniques.
const uid = useId()

const servers = computed(() => [
  {
    key: 'imap',
    title: t('devices.serverTable.imapTitle'),
    protocol: 'IMAP',
    icon: ArrowDownToLine,
    kind: t('devices.serverTable.kindImap'),
    server: props.settings.imap,
  },
  {
    key: 'smtp',
    title: t('devices.serverTable.smtpTitle'),
    protocol: 'SMTP',
    icon: ArrowUpFromLine,
    kind: t('devices.serverTable.kindSmtp'),
    server: props.settings.smtp,
  },
].map(s => ({ ...s, headingId: `${uid}-${s.key}`, security: clientSecurityLabel(s.server.security) })))
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <section
      v-for="s in servers"
      :key="s.key"
      class="rounded-lg border border-border bg-surface-panel"
      :aria-labelledby="s.headingId"
    >
      <h4 :id="s.headingId" class="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
        <component :is="s.icon" class="size-4 text-muted-foreground" aria-hidden="true" />
        {{ s.title }}
        <span class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">{{ s.protocol }}</span>
      </h4>
      <dl class="divide-y divide-border">
        <div class="relative py-2.5 pr-14 pl-4">
          <dt class="text-xs text-muted-foreground">{{ t('devices.serverTable.serverLabel') }}</dt>
          <dd class="font-mono text-[15px] break-all">
            {{ s.server.host }}
            <SettingsDevicesCopyButton :value="s.server.host" :label="t('devices.serverTable.copyServer', { kind: s.kind })" class="absolute top-1/2 right-1.5 -translate-y-1/2" />
          </dd>
        </div>
        <div class="relative py-2.5 pr-14 pl-4">
          <dt class="text-xs text-muted-foreground">{{ t('devices.serverTable.portLabel') }}</dt>
          <dd class="font-mono text-[15px]">
            {{ s.server.port }}
            <SettingsDevicesCopyButton :value="String(s.server.port)" :label="t('devices.serverTable.copyPort', { kind: s.kind })" class="absolute top-1/2 right-1.5 -translate-y-1/2" />
          </dd>
        </div>
        <div class="py-2.5 pr-14 pl-4">
          <dt class="text-xs text-muted-foreground">{{ t('devices.serverTable.securityLabel') }}</dt>
          <dd class="text-[15px]">{{ s.security }}</dd>
        </div>
        <div class="relative py-2.5 pr-14 pl-4">
          <dt class="text-xs text-muted-foreground">{{ t('devices.serverTable.usernameLabel') }}</dt>
          <dd class="font-mono text-[15px] break-all">
            {{ settings.username }}
            <SettingsDevicesCopyButton :value="settings.username" :label="t('devices.serverTable.copyUsername')" class="absolute top-1/2 right-1.5 -translate-y-1/2" />
          </dd>
        </div>
        <div class="py-2.5 pr-4 pl-4">
          <dt class="text-xs text-muted-foreground">{{ t('devices.serverTable.passwordLabel') }}</dt>
          <dd class="text-[15px]">{{ t('devices.serverTable.passwordValue') }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
