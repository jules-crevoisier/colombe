<script setup lang="ts">
/**
 * La colombe en papier plié de l'application (app/components/brand/Dove.vue), avec sa
 * trace de vol en pointillés. Décorative : facettes suivant le thème (--dove-*), bec
 * orange (--beak).
 */
withDefaults(defineProps<{ trail?: boolean }>(), { trail: true })
</script>

<template>
  <svg
    class="cl-dove"
    :viewBox="trail ? '-46 0 112 52' : '4 4 60 44'"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-if="trail"
      class="cl-dove-trail"
      d="M-42 46 C-26 50 -14 30 -4 36 S 2 44 8 39"
      stroke="var(--dove-trail)"
      stroke-width="1.1"
      stroke-linecap="round"
      stroke-dasharray="2.2 3.6"
    />
    <g class="cl-dove-body" stroke="var(--dove-5)" stroke-width="0.5" stroke-linejoin="round">
      <polygon points="21,35 14,11 29,31" fill="var(--dove-5)" />
      <polygon points="21,35 27,7 38,30" fill="var(--dove-1)" />
      <polygon points="7,39 21,35 31,45" fill="var(--dove-3)" />
      <polygon points="21,35 38,30 31,45" fill="var(--dove-2)" />
      <polygon points="31,45 38,30 47,31" fill="var(--dove-4)" />
      <polygon points="38,30 49,19 47,31" fill="var(--dove-1)" />
      <polygon points="49,19 57,22.5 47,31" fill="var(--dove-3)" />
      <polygon points="57,22.5 62,25 55.5,26" fill="var(--beak)" stroke="none" />
    </g>
  </svg>
</template>
