<script setup lang="ts">
import { toast } from 'vue-sonner'
import { LogOut } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { intlLocale } from '~/lib/i18n'
import type { AccountActivity, ActiveSession, TwoFactorStatus, TwoFactorSetup } from '#shared/types/mail'

const { t } = useI18n()
const session = useUserSession()
const settingsApi = useSettingsApi()

const activity = ref<AccountActivity | null>(null)
const activityLoading = ref(true)
const sessions = ref<ActiveSession[]>([])
const sessionsLoading = ref(true)
const revokeOthersDialog = ref(false)
const revoking = ref(false)

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'long', timeStyle: 'short' })
}

async function loadActivity() {
  activityLoading.value = true
  try {
    activity.value = await settingsApi.accountActivity()
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
  }
  finally {
    activityLoading.value = false
  }
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    sessions.value = await settingsApi.sessions()
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
  }
  finally {
    sessionsLoading.value = false
  }
}

async function revokeOtherSessions() {
  revoking.value = true
  try {
    await settingsApi.revokeOtherSessions()
    revokeOthersDialog.value = false
    toast.success(t('security.sessions.success'))
    await loadSessions()
  }
  catch (err) {
    toast.error(errorText(err, t('security.sessions.failed')))
  }
  finally {
    revoking.value = false
  }
}

const status = ref<TwoFactorStatus | null>(null)
const setup = ref<TwoFactorSetup | null>(null)
const loading = ref(true)
const setupError = ref('')
const confirmCode = ref('')
const confirmError = ref('')
const isConfirming = ref(false)
const recoveryCodesShown = ref<string[] | null>(null)
const regenerateCode = ref('')
const regenerateError = ref('')
const isRegenerating = ref(false)
const regenerateDialog = ref(false)
const disableCode = ref('')
const disableError = ref('')
const disableDialog = ref(false)
const recoveryCodesSuffix = computed(() => (status.value?.recoveryCodesLeft !== 1 ? 's' : ''))

async function loadStatus() {
  loading.value = true
  try {
    const fetcher = $fetch as (url: string, init: { method: 'GET' }) => Promise<TwoFactorStatus>
    status.value = await fetcher('/api/account/2fa', { method: 'GET' })
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
  }
  finally {
    loading.value = false
  }
}

async function initSetup() {
  setupError.value = ''
  try {
    const fetcher = $fetch as (url: string, init: { method: 'POST' }) => Promise<TwoFactorSetup>
    setup.value = await fetcher('/api/account/2fa/setup', { method: 'POST' })
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
    else {
      setupError.value =
        errorText(err, t('security.twoFactor.initError'))
    }
  }
}

async function confirmSetup() {
  confirmError.value = ''
  if (!confirmCode.value) {
    confirmError.value = t('security.twoFactor.setup.enterCode')
    return
  }

  isConfirming.value = true
  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'POST'; body: { code: string } }
    ) => Promise<{ recoveryCodes: string[] }>
    const result = await fetcher('/api/account/2fa/enable', {
      method: 'POST',
      body: { code: confirmCode.value },
    })
    recoveryCodesShown.value = result.recoveryCodes
    setup.value = null
    confirmCode.value = ''
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
    else {
      confirmError.value =
        errorText(err, t('security.twoFactor.codeIncorrect'))
    }
  }
  finally {
    isConfirming.value = false
  }
}

async function finishRecoveryCodes() {
  recoveryCodesShown.value = null
  confirmCode.value = ''
  await loadStatus()
}

async function copyToClipboard(text: string, message = t('security.twoFactor.recoveryCodes.copyGeneric')) {
  try {
    await window.navigator.clipboard.writeText(text)
    toast.success(message)
  }
  catch {
    toast.error(t('security.twoFactor.recoveryCodes.copyFailed'))
  }
}

async function copyRecoveryCodes() {
  if (!recoveryCodesShown.value) return
  const text = recoveryCodesShown.value.join('\n')
  await copyToClipboard(text, t('security.twoFactor.recoveryCodes.copySuccess'))
}

async function downloadRecoveryCodes() {
  if (!recoveryCodesShown.value) return
  const text = recoveryCodesShown.value.join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = t('security.twoFactor.recoveryCodes.filename')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function regenerateRecoveryCodes() {
  regenerateError.value = ''
  if (!regenerateCode.value) {
    regenerateError.value = t('security.twoFactor.regenerateDialog.enterCode')
    return
  }

  isRegenerating.value = true
  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'POST'; body: { code: string } }
    ) => Promise<{ recoveryCodes: string[] }>
    const result = await fetcher('/api/account/2fa/recovery-codes', {
      method: 'POST',
      body: { code: regenerateCode.value },
    })
    recoveryCodesShown.value = result.recoveryCodes
    regenerateCode.value = ''
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
    else {
      regenerateError.value =
        errorText(err, t('security.twoFactor.codeIncorrect'))
    }
  }
  finally {
    isRegenerating.value = false
  }
}

async function disableTwoFactor() {
  disableError.value = ''
  if (!disableCode.value) {
    disableError.value = t('security.twoFactor.disableDialog.enterCode')
    return
  }

  try {
    const fetcher = $fetch as (
      url: string,
      init: { method: 'POST'; body: { code: string } }
    ) => Promise<null>
    await fetcher('/api/account/2fa/disable', {
      method: 'POST',
      body: { code: disableCode.value },
    })
    disableDialog.value = false
    disableCode.value = ''
    await loadStatus()
  }
  catch (err) {
    if (statusOf(err) === 401) {
      await session.clear()
      await navigateTo('/login')
    }
    else {
      disableError.value =
        errorText(err, t('security.twoFactor.codeIncorrect'))
    }
  }
}

onMounted(() => {
  void loadStatus()
  void loadActivity()
  void loadSessions()
})
</script>

<template>
  <div class="space-y-10">
    <!-- Dernière connexion et activité récente (R2.6) -->
    <div class="space-y-4">
      <div>
        <h3 class="font-heading text-xl font-medium">{{ t('security.lastLogin.title') }}</h3>
        <div v-if="activityLoading" class="mt-2"><Skeleton class="h-10 w-full" /></div>
        <p v-else-if="activity?.lastLogin" class="mt-2 text-sm text-muted-foreground">
          {{ t('security.lastLogin.info', { date: formatEventDate(activity.lastLogin.at), ip: activity.lastLogin.ip, userAgent: activity.lastLogin.userAgent }) }}
        </p>
        <p v-else class="mt-2 text-sm text-muted-foreground">{{ t('security.lastLogin.empty') }}</p>
      </div>

      <div>
        <h3 class="font-heading text-xl font-medium">{{ t('security.recentActivity.title') }}</h3>
        <div v-if="activityLoading" class="mt-2 space-y-2">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
        <p v-else-if="!activity?.recent.length" class="mt-2 text-sm text-muted-foreground">{{ t('security.recentActivity.empty') }}</p>
        <ul v-else class="mt-2 flex flex-col gap-2">
          <li v-for="(event, i) in activity.recent" :key="i" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-2 text-sm">
            <span>{{ t('security.recentActivity.entry', { date: formatEventDate(event.at), ip: event.ip, userAgent: event.userAgent }) }}</span>
            <Badge :variant="event.success ? 'secondary' : 'destructive'">{{ event.success ? t('security.recentActivity.success') : t('security.recentActivity.failed') }}</Badge>
          </li>
        </ul>
      </div>
    </div>

    <!-- Sessions actives (R2.6) -->
    <div class="space-y-4 border-t border-border pt-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-heading text-xl font-medium">{{ t('security.sessions.title') }}</h3>
        <Button variant="outline" class="h-11 rounded-lg px-5" :disabled="sessionsLoading || sessions.length <= 1" @click="revokeOthersDialog = true">
          <LogOut class="size-4" aria-hidden="true" />
          {{ t('security.sessions.revokeOthers') }}
        </Button>
      </div>
      <div v-if="sessionsLoading" class="space-y-2">
        <Skeleton class="h-12 w-full" />
        <Skeleton class="h-12 w-full" />
      </div>
      <ul v-else class="flex flex-col gap-2">
        <li v-for="s in sessions" :key="s.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-2 text-sm">
          <span>
            {{ t('security.sessions.entry', { userAgent: s.userAgent, ip: s.ip }) }}
            <span class="text-muted-foreground">{{ t('security.sessions.lastSeen', { date: formatEventDate(s.lastSeenAt) }) }}</span>
          </span>
          <Badge v-if="s.current" variant="secondary">{{ t('security.sessions.current') }}</Badge>
        </li>
      </ul>

      <AlertDialog v-model:open="revokeOthersDialog">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('security.sessions.confirmTitle') }}</AlertDialogTitle>
            <AlertDialogDescription>{{ t('security.sessions.confirmDescription') }}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
            <AlertDialogAction :disabled="revoking" @click="revokeOtherSessions">
              {{ revoking ? t('security.sessions.revoking') : t('security.sessions.revokeOthers') }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

    <!-- Double authentification -->
    <div class="space-y-6 border-t border-border pt-8">
    <p class="text-sm text-muted-foreground">
      {{ t('security.twoFactor.intro') }}
    </p>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Skeleton class="h-10 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>

    <!-- Disabled state -->
    <div v-else-if="!status?.enabled && !setup && !recoveryCodesShown">
      <div class="space-y-4">
        <p class="text-sm text-foreground">
          {{ t('security.twoFactor.disabledDescription') }}
        </p>
        <Button @click="initSetup">
          {{ t('security.twoFactor.enable') }}
        </Button>
      </div>
    </div>

    <!-- Setup step 1: QR code -->
    <div v-else-if="setup && !recoveryCodesShown" class="space-y-6">
      <div class="space-y-2">
        <h3 class="font-heading text-xl font-medium">{{ t('security.twoFactor.setup.step1Title') }}</h3>
        <p class="text-sm text-muted-foreground">
          {{ t('security.twoFactor.setup.scanHint') }}
        </p>
      </div>

      <!-- QR code rendu en <img> (data:) : un SVG chargé comme image ne peut exécuter aucun script. -->
      <div class="flex justify-center rounded-lg bg-white p-4">
        <img :src="`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`" :alt="t('security.twoFactor.setup.qrAlt')" class="size-56">
      </div>

      <!-- Secret for manual entry -->
      <div class="space-y-3">
        <p class="text-sm text-muted-foreground">
          {{ t('security.twoFactor.setup.manualEntry') }}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code class="flex-1 break-all rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm font-mono">
            {{ setup.secret.match(/.{1,4}/g)?.join(' ') }}
          </code>
          <Button
            variant="outline"
            size="sm"
            @click="async () => setup && await copyToClipboard(setup.secret, t('security.twoFactor.setup.copyKeySuccess'))"
          >
            {{ t('security.twoFactor.setup.copyKey') }}
          </Button>
        </div>
      </div>

      <!-- Confirmation code input -->
      <div class="space-y-3">
        <Label for="confirm-code" class="text-base font-medium">{{ t('security.twoFactor.setup.confirmLabel') }}</Label>
        <Input
          id="confirm-code"
          v-model="confirmCode"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          :placeholder="t('security.twoFactor.codePlaceholder')"
          class="text-base"
        />
        <p v-if="confirmError" role="alert" class="text-sm font-medium text-destructive">
          {{ confirmError }}
        </p>
      </div>

      <div class="flex gap-2 sm:justify-end">
        <Button
          variant="outline"
          @click="setup = null; confirmCode = ''"
        >
          {{ t('security.twoFactor.setup.cancel') }}
        </Button>
        <Button
          :disabled="!confirmCode || isConfirming"
          @click="confirmSetup"
        >
          {{ isConfirming ? t('security.twoFactor.setup.confirming') : t('security.twoFactor.setup.confirm') }}
        </Button>
      </div>
    </div>

    <!-- Recovery codes display -->
    <div v-else-if="recoveryCodesShown" class="space-y-6">
      <div class="space-y-2">
        <h3 class="font-heading text-xl font-medium">{{ t('security.twoFactor.recoveryCodes.title') }}</h3>
        <div class="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          <strong>{{ t('security.twoFactor.recoveryCodes.important') }}</strong> {{ t('security.twoFactor.recoveryCodes.onceOnly') }}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-panel p-4 font-mono text-sm">
        <div v-for="(code, i) of recoveryCodesShown" :key="i" class="break-all">
          {{ code }}
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          @click="copyRecoveryCodes"
        >
          {{ t('security.twoFactor.recoveryCodes.copy') }}
        </Button>
        <Button
          variant="outline"
          @click="downloadRecoveryCodes"
        >
          {{ t('security.twoFactor.recoveryCodes.download') }}
        </Button>
        <Button @click="finishRecoveryCodes">
          {{ t('security.twoFactor.recoveryCodes.saved') }}
        </Button>
      </div>
    </div>

    <!-- Enabled state -->
    <div v-else-if="status?.enabled" class="space-y-6">
      <div class="rounded-lg border border-border bg-surface-panel p-4">
        <p class="text-sm font-medium">{{ t('security.twoFactor.enabled.label') }}<span class="text-primary">{{ t('security.twoFactor.enabled.active') }}</span></p>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ t('security.twoFactor.enabled.codesLeft', { n: status.recoveryCodesLeft, suffix: recoveryCodesSuffix }) }}
        </p>
        <div v-if="status.recoveryCodesLeft <= 3" class="mt-3 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {{ t('security.twoFactor.enabled.lowWarning') }}
        </div>
      </div>

      <!-- Regenerate recovery codes dialog -->
      <Dialog v-model:open="regenerateDialog">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{{ t('security.twoFactor.regenerateDialog.title') }}</DialogTitle>
            <DialogDescription>
              {{ t('security.twoFactor.regenerateDialog.description') }}
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-3">
            <div class="space-y-2">
              <Label for="regenerate-code" class="text-sm font-medium">{{ t('security.twoFactor.regenerateDialog.label') }}</Label>
              <Input
                id="regenerate-code"
                v-model="regenerateCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="7"
                :placeholder="t('security.twoFactor.codePlaceholder')"
              />
              <p v-if="regenerateError" role="alert" class="text-sm font-medium text-destructive">
                {{ regenerateError }}
              </p>
            </div>
          </div>
          <DialogFooter class="sm:justify-end">
            <Button
              variant="outline"
              @click="regenerateDialog = false; regenerateCode = ''"
            >
              {{ t('security.twoFactor.regenerateDialog.cancel') }}
            </Button>
            <Button
              :disabled="!regenerateCode || isRegenerating"
              @click="regenerateRecoveryCodes"
            >
              {{ isRegenerating ? t('security.twoFactor.regenerateDialog.generating') : t('security.twoFactor.regenerateDialog.confirm') }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Disable 2FA dialog -->
      <AlertDialog v-model:open="disableDialog">
        <AlertDialogContent class="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('security.twoFactor.disableDialog.title') }}</AlertDialogTitle>
            <AlertDialogDescription>
              {{ t('security.twoFactor.disableDialog.description') }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div class="space-y-3">
            <div class="space-y-2">
              <Label for="disable-code" class="text-sm font-medium">{{ t('security.twoFactor.disableDialog.label') }}</Label>
              <Input
                id="disable-code"
                v-model="disableCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="7"
                :placeholder="t('security.twoFactor.codePlaceholder')"
              />
              <p v-if="disableError" role="alert" class="text-sm font-medium text-destructive">
                {{ disableError }}
              </p>
            </div>
          </div>
          <AlertDialogFooter class="sm:justify-end">
            <AlertDialogCancel @click="disableCode = ''">
              {{ t('security.twoFactor.disableDialog.cancel') }}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              :disabled="!disableCode"
              @click="disableTwoFactor"
            >
              {{ t('security.twoFactor.disableDialog.confirm') }}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          @click="regenerateDialog = true"
        >
          {{ t('security.twoFactor.enabled.regenerate') }}
        </Button>
        <Button
          variant="destructive"
          @click="disableDialog = true"
        >
          {{ t('security.twoFactor.enabled.disable') }}
        </Button>
      </div>
    </div>
    </div>
  </div>
</template>
