<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/** Bloc de la page : titre h3 relié à la section, ou « donnée indisponible » si le bloc manque. */
defineProps<{
  id: string
  title: string
  /** Le bloc vaut null dans le fichier de surveillance. */
  unavailable?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <section class="space-y-4 border-t border-border pt-8" :aria-labelledby="`server-status-${id}-title`">
    <h3 :id="`server-status-${id}-title`" class="font-heading text-xl font-medium">{{ title }}</h3>
    <p v-if="unavailable" class="text-sm text-muted-foreground">{{ t('serverStatus.unavailableBlock') }}</p>
    <slot v-else />
  </section>
</template>
