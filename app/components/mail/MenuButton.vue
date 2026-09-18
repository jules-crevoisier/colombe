<script setup lang="ts">
import type { Component } from 'vue'

/**
 * Bouton icône qui ouvre un DropdownMenu, avec infobulle. À placer dans un <DropdownMenu>.
 *
 * Dans Reka UI, <Tooltip> crée son propre contexte de positionnement (Popper) :
 * un DropdownMenuTrigger placé À L'INTÉRIEUR d'un Tooltip s'enregistre comme
 * ancre de l'infobulle, et le menu s'ouvre hors de l'écran (translate(0, -200%)).
 * Le déclencheur du menu est donc à l'extérieur ; l'infobulle vit à l'intérieur,
 * sur l'icône.
 */
defineProps<{ label: string; icon: Component }>()
</script>

<template>
  <DropdownMenuTrigger
    :aria-label="label"
    class="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-accent lg:size-10"
  >
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="grid size-full place-items-center" aria-hidden="true">
          <component :is="icon" class="size-5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ label }}</TooltipContent>
    </Tooltip>
  </DropdownMenuTrigger>
</template>
