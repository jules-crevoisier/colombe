<script setup lang="ts">
/** Un chiffre et son intitulé, dans une liste de définitions (<dl>). */
defineProps<{
  label: string
  value: string
}>()
</script>

<template>
  <div class="min-w-0">
    <dt class="text-sm text-muted-foreground">{{ label }}</dt>
    <dd class="font-heading text-2xl leading-tight font-medium tabular-nums">{{ value }}</dd>
  </div>
</template>
