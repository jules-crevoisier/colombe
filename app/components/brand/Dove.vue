<script setup lang="ts">
/**
 * Colombe en papier plié, sans le carré du logo, suivie d'une trace de vol en
 * pointillés. Illustration décorative des états vides et de la connexion : les
 * facettes suivent le thème (tokens --dove-*), le bec reste orange.
 * `trail` : affiche la trace de vol (par défaut) ; `false` pour la colombe seule.
 */
withDefaults(defineProps<{ trail?: boolean }>(), { trail: true })
</script>

<template>
  <svg :viewBox="trail ? '-46 0 112 52' : '4 4 60 44'" fill="none" aria-hidden="true" focusable="false">
    <path
      v-if="trail"
      d="M-42 46 C-26 50 -14 30 -4 36 S 2 44 8 39"
      stroke="var(--dove-trail)"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-dasharray="2.5 4"
    />
    <g stroke="var(--dove-5)" stroke-width="0.5" stroke-linejoin="round">
      <polygon points="21,35 14,11 29,31" fill="var(--dove-5)" />
      <polygon points="21,35 27,7 38,30" fill="var(--dove-1)" />
      <polygon points="7,39 21,35 31,45" fill="var(--dove-3)" />
      <polygon points="21,35 38,30 31,45" fill="var(--dove-2)" />
      <polygon points="31,45 38,30 47,31" fill="var(--dove-4)" />
      <polygon points="38,30 49,19 47,31" fill="var(--dove-1)" />
      <polygon points="49,19 57,22.5 47,31" fill="var(--dove-3)" />
    </g>
    <polygon points="57,22.5 62,25 55.5,26" fill="var(--beak)" />
  </svg>
</template>
