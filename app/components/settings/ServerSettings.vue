<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const prefs = usePrefsStore()
const { t } = useI18n()
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">{{ t('settings.server.emptyTrashOnLogout.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.server.emptyTrashOnLogout.description') }}</p>
      </div>
      <Switch
        :model-value="prefs.prefs.logoutEmptyTrash"
        @update:model-value="(v: boolean) => void prefs.save({ logoutEmptyTrash: v })"
        :aria-label="t('settings.server.emptyTrashOnLogout.label')"
      />
    </div>

    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">{{ t('settings.server.expungeOnLogout.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.server.expungeOnLogout.description') }}</p>
      </div>
      <Switch
        :model-value="prefs.prefs.logoutExpunge"
        @update:model-value="(v: boolean) => void prefs.save({ logoutExpunge: v })"
        :aria-label="t('settings.server.expungeOnLogout.label')"
      />
    </div>

    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">{{ t('settings.server.permanentDelete.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.server.permanentDelete.description') }}</p>
      </div>
      <Switch
        :model-value="prefs.prefs.deleteMode === 'permanent'"
        @update:model-value="(v: boolean) => void prefs.save({ deleteMode: v ? 'permanent' : 'trash' })"
        :aria-label="t('settings.server.permanentDelete.label')"
      />
    </div>
  </div>
</template>
