<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { LanguagePref } from '#shared/types/i18n'

const prefs = usePrefsStore()
const { t } = useI18n()
const { choose: chooseStoredLanguage, clear: clearStoredLanguage } = useStoredLanguageChoice()

const languageOptions = computed(() => [
  { value: 'auto' as const, label: t('language.auto') },
  { value: 'fr' as const, label: t('language.fr') },
  { value: 'en' as const, label: t('language.en') },
])

/**
 * « Automatique » efface le choix mémorisé dans ce navigateur (retour à la détection du
 * navigateur) ; Français/English l'y écrit — jamais l'inverse (voir useLanguage).
 */
function setLanguage(language: LanguagePref): void {
  if (language === 'auto') clearStoredLanguage()
  else chooseStoredLanguage(language)
  void prefs.save({ language })
}

const pageSizeOptions = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
] as const

const densityOptions = computed(() => [
  { value: 'comfortable' as const, label: t('settings.general.density.options.comfortable') },
  { value: 'compact' as const, label: t('settings.general.density.options.compact') },
])

const undoSendOptions = computed(() => [
  { value: 0, label: t('settings.general.undoSend.options.off') },
  { value: 5, label: t('settings.general.undoSend.options.s5') },
  { value: 10, label: t('settings.general.undoSend.options.s10') },
  { value: 20, label: t('settings.general.undoSend.options.s20') },
] as const)

const readingPaneOptions = computed(() => [
  { value: 'right' as const, label: t('settings.general.readingPane.options.right') },
  { value: 'none' as const, label: t('settings.general.readingPane.options.none') },
])

const markReadDelayOptions = computed(() => [
  { value: 0, label: t('settings.general.markRead.options.immediate') },
  { value: 5, label: t('settings.general.markRead.options.after5') },
  { value: 10, label: t('settings.general.markRead.options.after10') },
  { value: -1, label: t('settings.general.markRead.options.never') },
] as const)

const dateFormatOptions = computed(() => [
  { value: 'relative' as const, label: t('settings.general.dateFormat.options.relative') },
  { value: 'short' as const, label: t('settings.general.dateFormat.options.short') },
  { value: 'long' as const, label: t('settings.general.dateFormat.options.long') },
])

const timeFormatOptions = computed(() => [
  { value: '24h' as const, label: t('settings.general.timeFormat.options.h24') },
  { value: '12h' as const, label: t('settings.general.timeFormat.options.h12') },
])

const idleMinutesOptions = computed(() => [
  { value: 15, label: t('settings.general.idleMinutes.options.m15') },
  { value: 30, label: t('settings.general.idleMinutes.options.m30') },
  { value: 60, label: t('settings.general.idleMinutes.options.h1') },
  { value: 120, label: t('settings.general.idleMinutes.options.h2') },
] as const)

// Liste courte : les fuseaux les plus utiles au département, plus le fuseau actuel s'il diffère.
const TIME_ZONES = ['Europe/Paris', 'Europe/London', 'America/New_York', 'America/Guadeloupe', 'Indian/Reunion', 'UTC']
const timeZoneOptions = computed(() => {
  const zones = new Set(TIME_ZONES)
  zones.add(prefs.prefs.timeZone)
  return Array.from(zones)
})

async function handleNotificationsChange(enabled: boolean) {
  if (enabled) {
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.info(t('settings.general.desktopNotifications.permissionDenied'))
        return
      }
    }
    catch (err) {
      toast.error(t('settings.general.desktopNotifications.permissionError'))
      return
    }
  }
  await prefs.save({ desktopNotifications: enabled })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Langue -->
    <div class="space-y-2">
      <Label for="setting-language" class="text-base font-medium">{{ t('language.label') }}</Label>
      <Select :model-value="prefs.prefs.language" @update:model-value="(v: string) => void setLanguage(v as LanguagePref)">
        <SelectTrigger id="setting-language" class="h-11 w-full text-base sm:w-80">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of languageOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Messages par page -->
    <div class="space-y-2">
      <Label :for="'pref-page-size'" class="text-base font-medium">{{ t('settings.general.pageSize.label') }}</Label>
      <p class="text-sm text-muted-foreground">{{ t('settings.general.pageSize.description') }}</p>
      <Select :model-value="`${prefs.prefs.pageSize}`" @update:model-value="(v: string) => void prefs.save({ pageSize: Number(v) as 25 | 50 | 100 })">
        <SelectTrigger id="pref-page-size" class="h-11 w-full text-base sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of pageSizeOptions" :key="opt.value" :value="`${opt.value}`">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Densité d'affichage -->
    <div class="space-y-2">
      <Label :for="'pref-density'" class="text-base font-medium">{{ t('settings.general.density.label') }}</Label>
      <p class="text-sm text-muted-foreground">{{ t('settings.general.density.description') }}</p>
      <Select :model-value="prefs.prefs.density" @update:model-value="(v: string) => void prefs.save({ density: v as 'comfortable' | 'compact' })">
        <SelectTrigger id="pref-density" class="h-11 w-full text-base sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of densityOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Annuler l'envoi -->
    <div class="space-y-2">
      <Label :for="'pref-undo-send'" class="text-base font-medium">{{ t('settings.general.undoSend.label') }}</Label>
      <p class="text-sm text-muted-foreground">{{ t('settings.general.undoSend.description') }}</p>
      <Select :model-value="`${prefs.prefs.undoSendSeconds}`" @update:model-value="(v: string) => void prefs.save({ undoSendSeconds: Number(v) as 0 | 5 | 10 | 20 })">
        <SelectTrigger id="pref-undo-send" class="h-11 w-full text-base sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt of undoSendOptions" :key="opt.value" :value="`${opt.value}`">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Vue conversation -->
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">{{ t('settings.general.conversationView.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.general.conversationView.description') }}</p>
      </div>
      <Switch
        :model-value="prefs.prefs.conversationView"
        @update:model-value="(v: boolean) => void prefs.save({ conversationView: v })"
        :aria-label="t('settings.general.conversationView.label')"
      />
    </div>

    <!-- Notifications du bureau -->
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">{{ t('settings.general.desktopNotifications.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.general.desktopNotifications.description') }}</p>
      </div>
      <Switch
        :model-value="prefs.prefs.desktopNotifications"
        @update:model-value="handleNotificationsChange"
        :aria-label="t('settings.general.desktopNotifications.label')"
      />
    </div>

    <div class="border-t border-border pt-8">
      <h3 class="mb-5 font-heading text-xl font-medium">{{ t('settings.general.sections.reading') }}</h3>
      <div class="space-y-8">
        <!-- Volet de lecture -->
        <div class="space-y-2">
          <Label :for="'pref-reading-pane'" class="text-base font-medium">{{ t('settings.general.readingPane.label') }}</Label>
          <p class="text-sm text-muted-foreground">{{ t('settings.general.readingPane.description') }}</p>
          <Select :model-value="prefs.prefs.readingPane" @update:model-value="(v: string) => void prefs.save({ readingPane: v as 'none' | 'right' })">
            <SelectTrigger id="pref-reading-pane" class="h-11 w-full text-base sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt of readingPaneOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Marquer comme lu -->
        <div class="space-y-2">
          <Label :for="'pref-mark-read'" class="text-base font-medium">{{ t('settings.general.markRead.label') }}</Label>
          <Select :model-value="`${prefs.prefs.markReadDelay}`" @update:model-value="(v: string) => void prefs.save({ markReadDelay: Number(v) as 0 | 5 | 10 | -1 })">
            <SelectTrigger id="pref-mark-read" class="h-11 w-full text-base sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt of markReadDelayOptions" :key="opt.value" :value="`${opt.value}`">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Fuseau horaire -->
        <div class="space-y-2">
          <Label :for="'pref-timezone'" class="text-base font-medium">{{ t('settings.general.timeZone.label') }}</Label>
          <Select :model-value="prefs.prefs.timeZone" @update:model-value="(v: string) => void prefs.save({ timeZone: v })">
            <SelectTrigger id="pref-timezone" class="h-11 w-full text-base sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="zone of timeZoneOptions" :key="zone" :value="zone">
                {{ zone }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Format de date -->
        <div class="space-y-2">
          <Label :for="'pref-date-format'" class="text-base font-medium">{{ t('settings.general.dateFormat.label') }}</Label>
          <Select :model-value="prefs.prefs.dateFormat" @update:model-value="(v: string) => void prefs.save({ dateFormat: v as 'relative' | 'short' | 'long' })">
            <SelectTrigger id="pref-date-format" class="h-11 w-full text-base sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt of dateFormatOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Format de l'heure -->
        <div class="space-y-2">
          <Label :for="'pref-time-format'" class="text-base font-medium">{{ t('settings.general.timeFormat.label') }}</Label>
          <Select :model-value="prefs.prefs.timeFormat" @update:model-value="(v: string) => void prefs.save({ timeFormat: v as '24h' | '12h' })">
            <SelectTrigger id="pref-time-format" class="h-11 w-full text-base sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt of timeFormatOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <div class="border-t border-border pt-8">
      <h3 class="mb-5 font-heading text-xl font-medium">{{ t('settings.general.sections.account') }}</h3>
      <!-- Inactivité (R2.6) : délai avant la boîte « Toujours là ? ». -->
      <div class="space-y-2">
        <Label :for="'pref-idle-minutes'" class="text-base font-medium">{{ t('settings.general.idleMinutes.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.general.idleMinutes.description') }}</p>
        <Select :model-value="`${prefs.prefs.idleMinutes}`" @update:model-value="(v: string) => void prefs.save({ idleMinutes: Number(v) as 15 | 30 | 60 | 120 })">
          <SelectTrigger id="pref-idle-minutes" class="h-11 w-full text-base sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="opt of idleMinutesOptions" :key="opt.value" :value="`${opt.value}`">
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  </div>
</template>
