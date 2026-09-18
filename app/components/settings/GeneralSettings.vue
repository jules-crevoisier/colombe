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
  </div>
</template>
