<script setup lang="ts">
import { useColorMode } from '@vueuse/core'
import { toast } from 'vue-sonner'

// Thème : suit le système, choix mémorisé (préférence d'affichage uniquement, aucune donnée sensible).
useColorMode({ storageKey: 'wm-color-mode' })

const route = useRoute()
const { loggedIn } = useUserSession()

// Boîtes « Bienvenue » et « Toujours là ? » (docs/PLAN-v3.md R2.1 / R2.6) : uniquement
// sur les pages authentifiées (messagerie et paramètres), jamais sur /login.
const isAuthedArea = computed(() => loggedIn.value && (route.path.startsWith('/mail') || route.path.startsWith('/settings')))

let lastLoginChecked = false

async function checkLastLogin() {
  if (lastLoginChecked) return
  lastLoginChecked = true
  const storageKey = 'wm-last-login-toast-shown'
  try {
    if (window.sessionStorage.getItem(storageKey)) return
    window.sessionStorage.setItem(storageKey, '1')
    const activity = await useSettingsApi().accountActivity()
    const successes = activity.recent.filter(e => e.success)
    const current = activity.lastLogin ?? successes[0] ?? null
    const previous = current ? successes.find(e => e.at !== current.at) ?? null : null
    if (current && previous && previous.ip !== current.ip) {
      const when = new Date(previous.at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
      toast(`Dernière connexion le ${when} depuis ${previous.ip}`)
    }
  }
  catch {
    // Une panne réseau ne doit jamais bloquer l'accès à la messagerie.
  }
}

watch(isAuthedArea, (active) => {
  if (active) void checkLastLogin()
}, { immediate: true })
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </TooltipProvider>
  <Toaster position="bottom-left" rich-colors />
  <template v-if="isAuthedArea">
    <AccountWelcomeDialog />
    <AccountIdleDialog />
  </template>
</template>
