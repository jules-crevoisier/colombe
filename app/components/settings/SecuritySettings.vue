<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { TwoFactorStatus, TwoFactorSetup } from '#shared/types/mail'

const session = useUserSession()

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
        errorText(err, 'Erreur lors de l\'initialisation.')
    }
  }
}

async function confirmSetup() {
  confirmError.value = ''
  if (!confirmCode.value) {
    confirmError.value = 'Entrez le code à 6 chiffres.'
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
        errorText(err, 'Code incorrect.')
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

async function copyToClipboard(text: string, message = 'Copié.') {
  try {
    await window.navigator.clipboard.writeText(text)
    toast.success(message)
  }
  catch {
    toast.error('Impossible de copier.')
  }
}

async function copyRecoveryCodes() {
  if (!recoveryCodesShown.value) return
  const text = recoveryCodesShown.value.join('\n')
  await copyToClipboard(text, 'Codes copiés.')
}

async function downloadRecoveryCodes() {
  if (!recoveryCodesShown.value) return
  const text = recoveryCodesShown.value.join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'codes-secours-webmail.txt'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function regenerateRecoveryCodes() {
  regenerateError.value = ''
  if (!regenerateCode.value) {
    regenerateError.value = 'Entrez votre code TOTP ou un code de secours.'
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
        errorText(err, 'Code incorrect.')
    }
  }
  finally {
    isRegenerating.value = false
  }
}

async function disableTwoFactor() {
  disableError.value = ''
  if (!disableCode.value) {
    disableError.value = 'Entrez votre code TOTP ou un code de secours.'
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
        errorText(err, 'Code incorrect.')
    }
  }
}

onMounted(loadStatus)
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-muted-foreground">
      La double authentification protège le webmail. Les logiciels de messagerie (Thunderbird, téléphone) utilisent toujours le mot de passe seul.
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
          La double authentification ajoute une couche de sécurité à votre compte. Vos identifiants volés ne suffisent plus pour accéder à votre messagerie.
        </p>
        <Button @click="initSetup">
          Activer la double authentification
        </Button>
      </div>
    </div>

    <!-- Setup step 1: QR code -->
    <div v-else-if="setup && !recoveryCodesShown" class="space-y-6">
      <div class="space-y-2">
        <h3 class="text-lg font-semibold">Étape 1 : Scanner le QR code</h3>
        <p class="text-sm text-muted-foreground">
          Scannez ce QR code avec une application d'authentification (Aegis, FreeOTP, Google Authenticator…)
        </p>
      </div>

      <!-- QR code rendu en <img> (data:) : un SVG chargé comme image ne peut exécuter aucun script. -->
      <div class="flex justify-center rounded-lg bg-white p-4">
        <img :src="`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`" alt="QR code de configuration de la double authentification" class="size-56">
      </div>

      <!-- Secret for manual entry -->
      <div class="space-y-3">
        <p class="text-sm text-muted-foreground">
          Ou entrez cette clé manuellement :
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code class="flex-1 break-all rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm font-mono">
            {{ setup.secret.match(/.{1,4}/g)?.join(' ') }}
          </code>
          <Button
            variant="outline"
            size="sm"
            @click="async () => setup && await copyToClipboard(setup.secret, 'Clé copiée.')"
          >
            Copier
          </Button>
        </div>
      </div>

      <!-- Confirmation code input -->
      <div class="space-y-3">
        <Label for="confirm-code" class="text-base font-medium">Entrez le code de confirmation</Label>
        <Input
          id="confirm-code"
          v-model="confirmCode"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          placeholder="000000"
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
          Annuler
        </Button>
        <Button
          :disabled="!confirmCode || isConfirming"
          @click="confirmSetup"
        >
          {{ isConfirming ? 'Vérification...' : 'Confirmer' }}
        </Button>
      </div>
    </div>

    <!-- Recovery codes display -->
    <div v-else-if="recoveryCodesShown" class="space-y-6">
      <div class="space-y-2">
        <h3 class="text-lg font-semibold">Codes de secours</h3>
        <div class="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          <strong>Important :</strong> Ces codes ne s'afficheront qu'une seule fois. Enregistrez-les dans un endroit sûr.
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
          Copier les codes
        </Button>
        <Button
          variant="outline"
          @click="downloadRecoveryCodes"
        >
          Télécharger (.txt)
        </Button>
        <Button @click="finishRecoveryCodes">
          J'ai enregistré mes codes
        </Button>
      </div>
    </div>

    <!-- Enabled state -->
    <div v-else-if="status?.enabled" class="space-y-6">
      <div class="rounded-lg border border-border bg-surface-panel p-4">
        <p class="text-sm font-medium">Double authentification : <span class="text-primary">Activée</span></p>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ status.recoveryCodesLeft }} code{{ status.recoveryCodesLeft !== 1 ? 's' : '' }} de secours restant{{ status.recoveryCodesLeft !== 1 ? 's' : '' }}
        </p>
        <div v-if="status.recoveryCodesLeft <= 3" class="mt-3 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Vous devriez régénérer vos codes de secours.
        </div>
      </div>

      <!-- Regenerate recovery codes dialog -->
      <Dialog v-model:open="regenerateDialog">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Régénérer les codes de secours</DialogTitle>
            <DialogDescription>
              Entrez votre code TOTP ou un code de secours actuel.
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-3">
            <div class="space-y-2">
              <Label for="regenerate-code" class="text-sm font-medium">Code TOTP ou code de secours</Label>
              <Input
                id="regenerate-code"
                v-model="regenerateCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="7"
                placeholder="000000"
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
              Annuler
            </Button>
            <Button
              :disabled="!regenerateCode || isRegenerating"
              @click="regenerateRecoveryCodes"
            >
              {{ isRegenerating ? 'Génération...' : 'Régénérer' }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Disable 2FA dialog -->
      <AlertDialog v-model:open="disableDialog">
        <AlertDialogContent class="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver la double authentification ?</AlertDialogTitle>
            <AlertDialogDescription>
              Votre compte sera moins sécurisé. Vous pourrez la réactiver à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div class="space-y-3">
            <div class="space-y-2">
              <Label for="disable-code" class="text-sm font-medium">Code TOTP ou code de secours</Label>
              <Input
                id="disable-code"
                v-model="disableCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="7"
                placeholder="000000"
              />
              <p v-if="disableError" role="alert" class="text-sm font-medium text-destructive">
                {{ disableError }}
              </p>
            </div>
          </div>
          <AlertDialogFooter class="sm:justify-end">
            <AlertDialogCancel @click="disableCode = ''">
              Annuler
            </AlertDialogCancel>
            <Button
              variant="destructive"
              :disabled="!disableCode"
              @click="disableTwoFactor"
            >
              Désactiver
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          @click="regenerateDialog = true"
        >
          Régénérer les codes de secours
        </Button>
        <Button
          variant="destructive"
          @click="disableDialog = true"
        >
          Désactiver
        </Button>
      </div>
    </div>
  </div>
</template>
