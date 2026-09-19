<script setup lang="ts">
import type { SecurityConfirmation, TwoFactorStatus } from '#shared/types/mail'

/**
 * « Confirmez votre identité » (docs/PLAN-v4.md section F) : demandée avant toute
 * redirection, notification, transfert ou script modifié à la main. Le mot de
 * passe (ou code TOTP) ne sert qu'à la requête relancée par l'appelant : il
 * n'est jamais conservé au-delà (pas de localStorage/sessionStorage/Pinia).
 *
 * Usage : `await dialogRef.withConfirmation((confirm) => api.save(form, confirm))`
 * — relance automatiquement l'action avec le mot de passe/code une fois
 * confirmé, et redemande (avec message d'erreur) si le serveur refuse encore.
 */
const open = ref(false)
const password = ref('')
const totpCode = ref('')
const error = ref('')
const twoFactorEnabled = ref(false)
const checkingStatus = ref(false)

let resolveRequest: ((value: SecurityConfirmation) => void) | null = null
let rejectRequest: ((reason: unknown) => void) | null = null

class ConfirmCancelled extends Error {
  constructor() { super('Confirmation annulée') ; this.name = 'ConfirmCancelled' }
}

async function loadTwoFactorStatus(): Promise<void> {
  checkingStatus.value = true
  try {
    const fetcher = $fetch as (url: string, init: { method: 'GET' }) => Promise<TwoFactorStatus>
    const status = await fetcher('/api/account/2fa', { method: 'GET' })
    twoFactorEnabled.value = status.enabled
  }
  catch {
    twoFactorEnabled.value = false
  }
  finally {
    checkingStatus.value = false
  }
}

function settle(): void {
  resolveRequest = null
  rejectRequest = null
}

/** Ouvre la boîte et résout quand l'utilisateur confirme (ou rejette s'il annule). */
async function request(initialError = ''): Promise<SecurityConfirmation> {
  password.value = ''
  totpCode.value = ''
  error.value = initialError
  await loadTwoFactorStatus()
  open.value = true
  return new Promise<SecurityConfirmation>((resolve, reject) => {
    resolveRequest = resolve
    rejectRequest = reject
  })
}

function cancel(): void {
  open.value = false
  const reject = rejectRequest
  settle()
  reject?.(new ConfirmCancelled())
}

function submit(): void {
  const value = twoFactorEnabled.value ? totpCode.value.trim() : password.value
  if (!value) return
  const payload: SecurityConfirmation = twoFactorEnabled.value ? { totpCode: value } : { confirmPassword: value }
  open.value = false
  const resolve = resolveRequest
  settle()
  resolve?.(payload)
}

/**
 * Exécute `action(undefined)` ; si le serveur répond 403 (« Confirmez votre
 * mot de passe. »), ouvre la boîte et relance `action(confirm)` — en boucle
 * tant que le serveur refuse la confirmation, avec un message d'erreur.
 */
async function withConfirmation<T>(action: (confirm?: SecurityConfirmation) => Promise<T>): Promise<T> {
  try {
    return await action()
  }
  catch (err) {
    if (statusOf(err) !== 403) throw err
    let message = ''
    for (;;) {
      const confirm = await request(message)
      try {
        return await action(confirm)
      }
      catch (err2) {
        if (statusOf(err2) !== 403) throw err2
        message = 'Mot de passe ou code incorrect.'
      }
    }
  }
}

defineExpose({ request, withConfirmation })
</script>

<template>
  <Dialog v-model:open="open" @update:open="(v: boolean) => { if (!v) cancel() }">
    <DialogContent class="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>Confirmez votre identité</DialogTitle>
        <DialogDescription>
          Cette action modifie une redirection ou un transfert : confirmez pour continuer.
        </DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="submit">
        <div v-if="!twoFactorEnabled" class="space-y-2">
          <Label for="confirm-identity-password">Mot de passe</Label>
          <Input
            id="confirm-identity-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="h-11 text-base"
            :disabled="checkingStatus"
          />
        </div>
        <div v-else class="space-y-2">
          <Label for="confirm-identity-totp">Code de vérification</Label>
          <Input
            id="confirm-identity-totp"
            v-model="totpCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            placeholder="000000"
            class="h-11 text-base"
          />
        </div>
        <p v-if="error" role="alert" class="text-sm font-medium text-destructive">{{ error }}</p>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" class="h-11 rounded-lg px-6" @click="cancel">Annuler</Button>
          <Button type="submit" class="h-11 rounded-lg px-6">Confirmer</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
