<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const prefs = usePrefsStore()
const { t } = useI18n()

const editorOptions = computed(() => [
  { value: true, label: t('settings.compose.editor.options.rich') },
  { value: false, label: t('settings.compose.editor.options.plain') },
])

const replyPositionOptions = computed(() => [
  { value: 'above' as const, label: t('settings.compose.replyPosition.options.above') },
  { value: 'below' as const, label: t('settings.compose.replyPosition.options.below') },
])
</script>

<template>
  <div class="space-y-8">
    <!-- Éditeur -->
    <div class="space-y-2">
      <Label :for="'pref-editor'" class="text-base font-medium">{{ t('settings.compose.editor.label') }}</Label>
      <p class="text-sm text-muted-foreground">{{ t('settings.compose.editor.description') }}</p>
      <Select :model-value="prefs.prefs.composeHtml ? 'true' : 'false'" @update:model-value="(v: string) => void prefs.save({ composeHtml: v === 'true' })">
        <SelectTrigger id="pref-editor" class="h-11 w-full text-base sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of editorOptions" :key="String(opt.value)" :value="opt.value ? 'true' : 'false'">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Position de la réponse -->
    <div class="space-y-2">
      <Label :for="'pref-reply-position'" class="text-base font-medium">{{ t('settings.compose.replyPosition.label') }}</Label>
      <Select :model-value="prefs.prefs.replyPosition" @update:model-value="(v: string) => void prefs.save({ replyPosition: v as 'above' | 'below' })">
        <SelectTrigger id="pref-reply-position" class="h-11 w-full text-base sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of replyPositionOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
