<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const prefs = usePrefsStore()
const { t } = useI18n()

const remoteImagesOptions = computed(() => [
  { value: 'never' as const, label: t('settings.display.remoteImages.options.never') },
  { value: 'contacts' as const, label: t('settings.display.remoteImages.options.contacts') },
  { value: 'always' as const, label: t('settings.display.remoteImages.options.always') },
])
</script>

<template>
  <div class="space-y-8">
    <!-- Afficher le HTML -->
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">{{ t('settings.display.preferHtml.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.display.preferHtml.description') }}</p>
      </div>
      <Switch
        :model-value="prefs.prefs.preferHtml"
        @update:model-value="(v: boolean) => void prefs.save({ preferHtml: v })"
        :aria-label="t('settings.display.preferHtml.label')"
      />
    </div>

    <!-- Images distantes -->
    <div class="space-y-2">
      <Label :for="'pref-remote-images'" class="text-base font-medium">{{ t('settings.display.remoteImages.label') }}</Label>
      <p class="text-sm text-muted-foreground">{{ t('settings.display.remoteImages.description') }}</p>
      <Select :model-value="prefs.prefs.remoteImages" @update:model-value="(v: string) => void prefs.save({ remoteImages: v as 'never' | 'contacts' | 'always' })">
        <SelectTrigger id="pref-remote-images" class="h-11 w-full text-base sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of remoteImagesOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
