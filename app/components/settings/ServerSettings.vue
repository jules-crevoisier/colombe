<script setup lang="ts">
const prefs = usePrefsStore()
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">Vider la corbeille à la déconnexion</Label>
        <p class="text-sm text-muted-foreground">Supprime définitivement le contenu de la Corbeille en quittant</p>
      </div>
      <Switch
        :model-value="prefs.prefs.logoutEmptyTrash"
        @update:model-value="(v: boolean) => void prefs.save({ logoutEmptyTrash: v })"
        aria-label="Vider la corbeille à la déconnexion"
      />
    </div>

    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">Compacter la boîte de réception à la déconnexion</Label>
        <p class="text-sm text-muted-foreground">Efface définitivement les messages déjà marqués supprimés</p>
      </div>
      <Switch
        :model-value="prefs.prefs.logoutExpunge"
        @update:model-value="(v: boolean) => void prefs.save({ logoutExpunge: v })"
        aria-label="Compacter la boîte de réception à la déconnexion"
      />
    </div>

    <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div class="space-y-1">
        <Label class="text-base font-medium">Supprimer définitivement au lieu de déplacer vers la corbeille</Label>
        <p class="text-sm text-muted-foreground">« Supprimer » efface le message sans passer par la Corbeille</p>
      </div>
      <Switch
        :model-value="prefs.prefs.deleteMode === 'permanent'"
        @update:model-value="(v: boolean) => void prefs.save({ deleteMode: v ? 'permanent' : 'trash' })"
        aria-label="Supprimer définitivement au lieu de déplacer vers la corbeille"
      />
    </div>
  </div>
</template>
