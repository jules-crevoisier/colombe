<script setup lang="ts">
import { toast } from 'vue-sonner'

const prefs = usePrefsStore()

const pageSizeOptions = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
] as const

const densityOptions = [
  { value: 'comfortable', label: 'Confortable' },
  { value: 'compact', label: 'Compacte' },
] as const

const undoSendOptions = [
  { value: 0, label: 'Désactivé' },
  { value: 5, label: '5 s' },
  { value: 10, label: '10 s' },
  { value: 20, label: '20 s' },
] as const

const readingPaneOptions = [
  { value: 'right', label: 'À droite' },
  { value: 'none', label: 'Aucun' },
] as const

const markReadDelayOptions = [
  { value: 0, label: 'Immédiatement' },
  { value: 5, label: 'Après 5 s' },
  { value: 10, label: 'Après 10 s' },
  { value: -1, label: 'Jamais' },
] as const

const dateFormatOptions = [
  { value: 'relative', label: 'Relatif' },
  { value: 'short', label: 'Court' },
  { value: 'long', label: 'Long' },
] as const

const timeFormatOptions = [
  { value: '24h', label: '24 h' },
  { value: '12h', label: '12 h' },
] as const

const idleMinutesOptions = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 heure' },
  { value: 120, label: '2 heures' },
] as const

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
        toast.info('Veuillez autoriser les notifications dans les paramètres du navigateur.')
        return
      }
    }
    catch (err) {
      toast.error('Erreur lors de la demande de permission.')
      return
    }
  }
  await prefs.save({ desktopNotifications: enabled })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Messages par page -->
    <div class="space-y-2">
      <Label :for="'pref-page-size'" class="text-base font-medium">Messages par page</Label>
      <p class="text-sm text-muted-foreground">Nombre de messages affichés dans la liste</p>
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
      <Label :for="'pref-density'" class="text-base font-medium">Densité d'affichage</Label>
      <p class="text-sm text-muted-foreground">Ajuste l'espacement et la taille des éléments</p>
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
      <Label :for="'pref-undo-send'" class="text-base font-medium">Annuler l'envoi</Label>
      <p class="text-sm text-muted-foreground">Délai avant l'envoi définitif du message</p>
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
        <Label class="text-base font-medium">Vue conversation</Label>
        <p class="text-sm text-muted-foreground">Groupe les messages par fil de discussion</p>
      </div>
      <Switch
        :model-value="prefs.prefs.conversationView"
        @update:model-value="(v: boolean) => void prefs.save({ conversationView: v })"
        aria-label="Vue conversation"
      />
    </div>

    <!-- Notifications du bureau -->
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">Notifications du bureau</Label>
        <p class="text-sm text-muted-foreground">Alertes pour les nouveaux messages</p>
      </div>
      <Switch
        :model-value="prefs.prefs.desktopNotifications"
        @update:model-value="handleNotificationsChange"
        aria-label="Notifications du bureau"
      />
    </div>

    <div class="border-t border-border pt-8">
      <h3 class="mb-6 text-lg font-semibold">Lecture</h3>
      <div class="space-y-8">
        <!-- Volet de lecture -->
        <div class="space-y-2">
          <Label :for="'pref-reading-pane'" class="text-base font-medium">Volet de lecture</Label>
          <p class="text-sm text-muted-foreground">Ignoré en dessous de 1024 px de large</p>
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
          <Label :for="'pref-mark-read'" class="text-base font-medium">Marquer comme lu</Label>
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
          <Label :for="'pref-timezone'" class="text-base font-medium">Fuseau horaire</Label>
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
          <Label :for="'pref-date-format'" class="text-base font-medium">Format de date</Label>
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
          <Label :for="'pref-time-format'" class="text-base font-medium">Format de l'heure</Label>
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
      <h3 class="mb-6 text-lg font-semibold">Compte</h3>
      <!-- Inactivité (R2.6) : délai avant la boîte « Toujours là ? ». -->
      <div class="space-y-2">
        <Label :for="'pref-idle-minutes'" class="text-base font-medium">Déconnexion pour inactivité</Label>
        <p class="text-sm text-muted-foreground">Délai avant que la messagerie demande « Toujours là ? »</p>
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
