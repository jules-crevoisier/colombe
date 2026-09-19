<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import type { MessageDetail, MessageSummary } from '#shared/types/mail'
import { useI18n } from 'vue-i18n'
import { intlLocale } from '~/lib/i18n'

const { t } = useI18n()

/**
 * Message d'une conversation, replié par défaut ; le corps n'est chargé qu'à l'ouverture.
 * Présentation « lettres empilées » : chaque message est une carte reliée aux autres par
 * un filet vertical, avec l'avatar de son expéditeur.
 */
const props = defineProps<{ item: MessageSummary; folderName: string | null }>()

const api = useMailApi()
const prefsStore = usePrefsStore()
const expanded = ref(false)
const detail = ref<MessageDetail | null>(null)
const loading = ref(false)
const failed = ref(false)
const showRemote = ref(false)

async function toggle() {
  expanded.value = !expanded.value
  if (!expanded.value || detail.value) return
  loading.value = true
  failed.value = false
  try {
    detail.value = await api.message(props.item.folder, props.item.uid)
    const pref = prefsStore.prefs.remoteImages
    showRemote.value = pref === 'always' || (pref === 'contacts' && detail.value.senderInContacts)
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

const sender = computed(() => props.item.from?.name || props.item.from?.address || t('mail.thread.unknownSender'))
const date = computed(() => formatFullDate(props.item.date, intlLocale(), { timeZone: prefsStore.prefs.timeZone, dateFormat: prefsStore.prefs.dateFormat, timeFormat: prefsStore.prefs.timeFormat }))
const html = computed(() => (prefsStore.prefs.preferHtml ? detail.value?.html ?? null : null))
</script>

<template>
  <li class="relative pb-2 before:absolute before:top-0 before:bottom-0 before:left-[27px] before:w-px before:bg-line-strong last:pb-3">
    <div class="relative rounded-lg border border-border bg-surface-panel transition-colors" :class="expanded ? 'shadow-sheet' : 'hover:border-line-strong'">
      <button type="button" class="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" :aria-expanded="expanded" @click="toggle">
        <span class="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" :class="getAvatarTone(item.from?.address ?? '')" aria-hidden="true">
          {{ getInitials(item.from?.name || item.from?.address.split('@')[0] || '?') }}
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex items-baseline gap-2">
            <span class="truncate text-sm font-semibold">{{ sender }}</span>
            <span v-if="folderName" class="stamp shrink-0 !leading-4">{{ folderName }}</span>
          </span>
          <span v-if="!expanded" class="truncate text-[13px] text-muted-foreground">{{ item.preview }}</span>
        </span>
        <time class="hidden shrink-0 text-xs text-muted-foreground sm:block" :datetime="item.date">{{ date }}</time>
        <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform duration-200" :class="{ 'rotate-180': expanded }" aria-hidden="true" />
      </button>
      <div v-if="expanded" class="px-3 pb-3">
        <time class="mb-2 block text-xs text-muted-foreground sm:hidden" :datetime="item.date">{{ date }}</time>
        <Skeleton v-if="loading" class="h-32 w-full rounded-lg" />
        <p v-else-if="failed" class="text-sm text-destructive" role="alert">{{ t('mail.thread.loadFailed') }}</p>
        <template v-else-if="detail">
          <button v-if="detail.remoteImages > 0 && !showRemote" type="button" class="mb-2 inline-flex min-h-11 items-center rounded-md px-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring lg:min-h-8" @click="showRemote = true">
            {{ t('mail.thread.showRemoteImages') }}
          </button>
          <div class="overflow-hidden rounded-md border border-border bg-white">
            <MailFrame :html="html" :text="detail.text" :show-remote="showRemote" class="!min-h-48" />
          </div>
        </template>
      </div>
    </div>
  </li>
</template>
