<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { toast } from 'vue-sonner'

const props = defineProps<{
  value: string
  /** Ce qui est copié, pour le nom accessible : « Copier le serveur de réception ». */
  label: string
}>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  try {
    await window.navigator.clipboard.writeText(props.value)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1600)
    toast.success('Copié')
  }
  catch {
    toast.error('Impossible de copier. Sélectionnez le texte à la main.')
  }
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button
    type="button"
    class="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    :aria-label="`Copier ${label}`"
    :title="`Copier ${label}`"
    @click="copy"
  >
    <Check v-if="copied" class="size-4 text-primary" aria-hidden="true" />
    <Copy v-else class="size-4" aria-hidden="true" />
  </button>
</template>
