<script setup lang="ts">
/**
 * Inactivité (docs/dev/PLAN-v3.md R2.6) : après `prefs.idleMinutes` sans activité,
 * demande « Toujours là ? ». Sans réponse dans les 60 s, déconnexion.
 */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const

const prefs = usePrefsStore()
const api = useMailApi()

const open = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | null = null
let logoutTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

function clearLogoutTimer() {
  if (logoutTimer) clearTimeout(logoutTimer)
  logoutTimer = null
}

function scheduleIdle() {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    open.value = true
    clearLogoutTimer()
    logoutTimer = setTimeout(() => void doLogout(), 60_000)
  }, prefs.prefs.idleMinutes * 60_000)
}

function onActivity() {
  // Une fois la boîte ouverte, seule une réponse explicite (« Rester connecté ») compte.
  if (open.value) return
  scheduleIdle()
}

async function doLogout() {
  open.value = false
  clearIdleTimer()
  clearLogoutTimer()
  await api.logout()
}

function stay() {
  open.value = false
  clearLogoutTimer()
  scheduleIdle()
}

onMounted(() => {
  for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true })
  scheduleIdle()
})

onBeforeUnmount(() => {
  for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity)
  clearIdleTimer()
  clearLogoutTimer()
})

watch(() => prefs.prefs.idleMinutes, () => {
  if (!open.value) scheduleIdle()
})
</script>

<template>
  <AlertDialog :open="open" @update:open="(v: boolean) => { if (!v) stay() }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Toujours là ?</AlertDialogTitle>
        <AlertDialogDescription>Vous allez être déconnecté automatiquement dans quelques instants.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction @click="stay">Rester connecté</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
