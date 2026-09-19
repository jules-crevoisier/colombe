<script setup lang="ts">
/**
 * Capture d'écran de l'application posée comme une feuille : cadre discret, barre
 * d'adresse, ombre portée. `dark` : variante affichée en mode sombre (chargée à la
 * demande). `device="phone"` : cadre de téléphone pour les captures mobiles.
 */
import { withBase } from 'vitepress'

const props = withDefaults(defineProps<{
  src: string
  dark?: string
  alt: string
  width: number
  height: number
  address?: string
  device?: 'browser' | 'phone'
  eager?: boolean
}>(), {
  dark: undefined,
  address: 'mail.universite.example',
  device: 'browser',
  eager: false,
})
</script>

<template>
  <div class="cl-frame" :class="`cl-frame--${props.device}`">
    <div v-if="props.device === 'browser'" class="cl-frame-bar" aria-hidden="true">
      <span class="cl-frame-dots"><i /><i /><i /></span>
      <span class="cl-frame-address">{{ props.address }}</span>
    </div>
    <img
      :class="{ 'cl-frame-light': props.dark }"
      :src="withBase(props.src)"
      :alt="props.alt"
      :width="props.width"
      :height="props.height"
      :loading="props.eager ? 'eager' : 'lazy'"
      :fetchpriority="props.eager ? 'high' : undefined"
      decoding="async"
    >
    <img
      v-if="props.dark"
      class="cl-frame-dark"
      :src="withBase(props.dark)"
      :alt="props.alt"
      :width="props.width"
      :height="props.height"
      loading="lazy"
      decoding="async"
    >
  </div>
</template>
