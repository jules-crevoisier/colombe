<script setup lang="ts">
import { useColorMode } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { intlLocale } from '~/lib/i18n'

// Thème : suit le système, choix mémorisé (préférence d'affichage uniquement, aucune donnée sensible).
useColorMode({ storageKey: 'wm-color-mode' })

// Langue active : préférence du compte, choix mémorisé ou langue du navigateur (voir useLanguage).
useLanguage()
const { t } = useI18n()

// Nom, organisation, liens de l'établissement (GET /api/config, public) : chargés une
// fois pour toute l'appli (page de connexion et messagerie), voir useSiteConfig().
const { load: loadSiteConfig } = useSiteConfig()
onMounted(() => { void loadSiteConfig() })

const route = useRoute()
const { loggedIn } = useUserSession()

// Boîtes « Bienvenue » et « Toujours là ? » (docs/dev/PLAN-v3.md R2.1 / R2.6) : uniquement
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
      const when = new Date(previous.at).toLocaleString(intlLocale(), { dateStyle: 'long', timeStyle: 'short' })
      toast(t('session.lastLogin', { when, ip: previous.ip }))
    }
  }
  catch {
    // Une panne réseau ne doit jamais bloquer l'accès à la messagerie.
  }
}

watch(isAuthedArea, (active) => {
  if (active) void checkLastLogin()
}, { immediate: true })

// ─── SSO (OIDC) : début ───
// Retour d'une réauthentification chez l'établissement (ConfirmIdentityDialog) :
// GET /api/auth/oidc/callback ramène sur la page d'origine avec ?reauth=ok|failed.
function onReauthResult(reauth: unknown): void {
  if (reauth !== 'ok' && reauth !== 'failed') return
  if (reauth === 'ok') toast.success(t('session.reauthOk'))
  else toast.error(t('session.reauthFailed'))
  const query = { ...route.query }
  delete query.reauth
  void navigateTo({ path: route.path, query, hash: route.hash }, { replace: true })
}
// Après le montage : le Toaster doit exister pour afficher le message.
onMounted(() => onReauthResult(route.query.reauth))
watch(() => route.query.reauth, onReauthResult)
// ─── SSO (OIDC) : fin ───
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
    <FiltersFilterDialog />
  </template>
</template>
