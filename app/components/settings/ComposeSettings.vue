<script setup lang="ts">
const prefs = usePrefsStore()

const editorOptions = [
  { value: true, label: 'Mise en forme' },
  { value: false, label: 'Texte brut' },
] as const

const replyPositionOptions = [
  { value: 'above', label: 'Au-dessus de la citation' },
  { value: 'below', label: 'En dessous' },
] as const
</script>

<template>
  <div class="space-y-8">
    <!-- Éditeur -->
    <div class="space-y-2">
      <Label :for="'pref-editor'" class="text-base font-medium">Éditeur</Label>
      <p class="text-sm text-muted-foreground">Type d'éditeur utilisé pour rédiger un nouveau message</p>
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
      <Label :for="'pref-reply-position'" class="text-base font-medium">Position de la réponse</Label>
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
