<script setup lang="ts">
/**
 * Logo Colombe (piste « Pli » : colombe en papier plié, choisie le 19/09).
 * Même dessin que public/favicon.svg. Décoratif par défaut ; `label` le rend lisible
 * par les lecteurs d'écran quand il est seul (ex. écran de connexion).
 */
defineProps<{ label?: string }>()
</script>

<template>
  <svg viewBox="0 0 64 64" :role="label ? 'img' : undefined" :aria-label="label" :aria-hidden="label ? undefined : 'true'">
    <rect width="64" height="64" rx="16" fill="#1f3a8a" />
    <polygon points="21,35 14,11 29,31" fill="#9fb6f0" />
    <polygon points="21,35 27,7 38,30" fill="#ffffff" />
    <polygon points="7,39 21,35 31,45" fill="#dbe5fb" />
    <polygon points="21,35 38,30 31,45" fill="#eef3fd" />
    <polygon points="31,45 38,30 47,31" fill="#c9d7f7" />
    <polygon points="38,30 49,19 47,31" fill="#ffffff" />
    <polygon points="49,19 57,22.5 47,31" fill="#dbe5fb" />
    <polygon points="57,22.5 62,25 55.5,26" fill="#f59e6b" />
  </svg>
</template>
