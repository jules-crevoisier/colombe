<script setup lang="ts">
import { useColorMode } from '@vueuse/core'

// Thème : suit le système, choix mémorisé (préférence d'affichage uniquement, aucune donnée sensible).
useColorMode({ storageKey: 'wm-color-mode' })
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </TooltipProvider>
  <Toaster position="bottom-left" rich-colors />
</template>
