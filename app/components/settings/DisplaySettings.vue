<script setup lang="ts">
const prefs = usePrefsStore()

const remoteImagesOptions = [
  { value: 'never', label: 'Jamais' },
  { value: 'contacts', label: 'Des contacts connus' },
  { value: 'always', label: 'Toujours' },
] as const
</script>

<template>
  <div class="space-y-8">
    <!-- Afficher le HTML -->
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">Afficher le HTML</Label>
        <p class="text-sm text-muted-foreground">Affiche la mise en forme des messages plutôt que le texte brut</p>
      </div>
      <Switch
        :model-value="prefs.prefs.preferHtml"
        @update:model-value="(v: boolean) => void prefs.save({ preferHtml: v })"
        aria-label="Afficher le HTML"
      />
    </div>

    <!-- Images distantes -->
    <div class="space-y-2">
      <Label :for="'pref-remote-images'" class="text-base font-medium">Images distantes</Label>
      <p class="text-sm text-muted-foreground">Chaque image distante peut servir à confirmer l'ouverture d'un message</p>
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
