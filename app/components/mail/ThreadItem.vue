<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import type { MessageDetail, MessageSummary } from '#shared/types/mail'

/** Message d'une conversation, replié par défaut ; le corps n'est chargé qu'à l'ouverture. */
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

const sender = computed(() => props.item.from?.name || props.item.from?.address || '(inconnu)')
const date = computed(() => formatFullDate(props.item.date, 'fr-FR', { timeZone: prefsStore.prefs.timeZone, dateFormat: prefsStore.prefs.dateFormat, timeFormat: prefsStore.prefs.timeFormat }))
const html = computed(() => (prefsStore.prefs.preferHtml ? detail.value?.html ?? null : null))
</script>

<template>
  <li class="rounded-xl border border-border/60">
    <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent/60" :aria-expanded="expanded" @click="toggle">
      <span class="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" :class="getAvatarColorClass(item.from?.address ?? '')" aria-hidden="true">
        {{ getInitials(item.from?.name || item.from?.address.split('@')[0] || '?') }}
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex items-baseline gap-2">
          <span class="truncate text-sm font-medium">{{ sender }}</span>
          <span v-if="folderName" class="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{{ folderName }}</span>
        </span>
        <span v-if="!expanded" class="truncate text-xs text-muted-foreground">{{ item.preview }}</span>
      </span>
      <time class="shrink-0 text-xs text-muted-foreground" :datetime="item.date">{{ date }}</time>
      <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ 'rotate-180': expanded }" aria-hidden="true" />
    </button>
    <div v-if="expanded" class="px-3 pb-3">
      <Skeleton v-if="loading" class="h-32 w-full rounded-lg" />
      <p v-else-if="failed" class="text-sm text-destructive" role="alert">Impossible d’afficher ce message.</p>
      <template v-else-if="detail">
        <button v-if="detail.remoteImages > 0 && !showRemote" type="button" class="mb-2 text-xs font-medium text-primary hover:underline" @click="showRemote = true">
          Afficher les images distantes
        </button>
        <MailFrame :html="html" :text="detail.text" :show-remote="showRemote" class="!min-h-48" />
      </template>
    </div>
  </li>
</template>
