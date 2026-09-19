<script setup lang="ts">
import { ArrowLeft, Eye, EyeOff, LoaderCircle, ShieldCheck } from '@lucide/vue'
import type { LoginResult } from '#shared/types/mail'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Connexion — Colombe' })

const step = ref<'password' | 'code'>('password')
const email = ref('')
const password = ref('')
const code = ref('')
const useRecovery = ref(false)
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const codeInput = ref<{ $el: HTMLInputElement } | null>(null)
const { fetch: refreshSession } = useUserSession()

function describe(err: unknown, context: 'password' | 'code'): string {
  const status = statusOf(err)
  if (status === 401) return context === 'password' ? 'Adresse ou mot de passe incorrect.' : errorText(err, 'Code incorrect.')
  if (status === 403 || status === 429 || status === 503) return errorText(err)
  if (status === 400) return context === 'password' ? 'Saisissez une adresse e-mail valide et votre mot de passe.' : 'Code invalide.'
  return 'Connexion impossible pour le moment. Réessayez plus tard.'
}

async function finish() {
  password.value = ''
  code.value = ''
  await refreshSession()
  await navigateTo('/mail/INBOX', { replace: true })
}

async function submitPassword() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<LoginResult>('/api/auth/login', { method: 'POST', body: { email: email.value.trim(), password: password.value } })
    if (res.twoFactorRequired) {
      password.value = ''
      step.value = 'code'
      await nextTick()
      codeInput.value?.$el.focus()
      return
    }
    await finish()
  }
  catch (err) {
    error.value = describe(err, 'password')
  }
  finally {
    loading.value = false
  }
}

async function submitCode() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await $fetch<LoginResult>('/api/auth/2fa', { method: 'POST', body: { code: code.value.trim() } })
    await finish()
  }
  catch (err) {
    error.value = describe(err, 'code')
    code.value = ''
    // Attente expirée ou trop d'essais : retour à l'étape mot de passe.
    if (statusOf(err) === 401 && /reconnect|expir/i.test(error.value)) step.value = 'password'
  }
  finally {
    loading.value = false
  }
}

function backToPassword() {
  step.value = 'password'
  error.value = ''
  code.value = ''
}
</script>

<template>
  <main class="w-full max-w-[448px] rounded-3xl bg-surface-panel px-6 py-10 sm:px-10">
    <div class="mb-8 flex flex-col items-start gap-4">
      <span class="grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground" aria-hidden="true">
        <ShieldCheck v-if="step === 'code'" class="size-6" />
        <template v-else>M</template>
      </span>
      <div>
        <h1 class="text-3xl font-normal tracking-tight">{{ step === 'code' ? 'Validation en deux étapes' : 'Connexion' }}</h1>
        <p class="mt-2 text-base text-muted-foreground">
          <template v-if="step === 'code'">
            {{ useRecovery ? 'Saisissez l’un de vos codes de secours.' : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.' }}
          </template>
          <template v-else>Messagerie du département MMI — mmi-troyes.fr</template>
        </p>
      </div>
    </div>

    <form v-if="step === 'password'" class="flex flex-col gap-5" novalidate @submit.prevent="submitPassword">
      <div class="flex flex-col gap-2">
        <Label for="email">Adresse e-mail</Label>
        <Input id="email" v-model="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="prenom.nom@mmi-troyes.fr" required class="h-12 rounded-lg text-base" :aria-invalid="!!error || undefined" aria-describedby="login-error" />
      </div>

      <div class="flex flex-col gap-2">
        <Label for="password">Mot de passe</Label>
        <div class="relative">
          <Input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required class="h-12 rounded-lg pr-12 text-base" :aria-invalid="!!error || undefined" aria-describedby="login-error" />
          <button type="button" class="absolute top-0.5 right-0.5 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent" :aria-label="showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'" :aria-pressed="showPassword" @click="showPassword = !showPassword">
            <component :is="showPassword ? EyeOff : Eye" class="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p id="login-error" class="min-h-5 text-sm text-destructive" role="alert" aria-live="assertive">{{ error }}</p>

      <Button type="submit" class="h-12 w-full rounded-full text-base font-medium" :disabled="loading || !email || !password">
        <LoaderCircle v-if="loading" class="size-5 animate-spin" aria-hidden="true" />
        {{ loading ? 'Connexion…' : 'Se connecter' }}
      </Button>
    </form>

    <form v-else class="flex flex-col gap-5" novalidate @submit.prevent="submitCode">
      <div class="flex flex-col gap-2">
        <Label for="code">{{ useRecovery ? 'Code de secours' : 'Code de vérification' }}</Label>
        <Input
          id="code"
          ref="codeInput"
          v-model="code"
          :inputmode="useRecovery ? 'text' : 'numeric'"
          :autocomplete="useRecovery ? 'off' : 'one-time-code'"
          :maxlength="useRecovery ? 11 : 7"
          :placeholder="useRecovery ? 'XXXXX-XXXXX' : '123 456'"
          autocapitalize="characters"
          spellcheck="false"
          required
          class="h-12 rounded-lg text-center font-mono text-xl tracking-[0.3em]"
          :aria-invalid="!!error || undefined"
          aria-describedby="login-error"
        />
      </div>

      <p id="login-error" class="min-h-5 text-sm text-destructive" role="alert" aria-live="assertive">{{ error }}</p>

      <Button type="submit" class="h-12 w-full rounded-full text-base font-medium" :disabled="loading || code.trim().length < 6">
        <LoaderCircle v-if="loading" class="size-5 animate-spin" aria-hidden="true" />
        {{ loading ? 'Vérification…' : 'Valider' }}
      </Button>

      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" class="inline-flex h-11 items-center gap-1 rounded-full px-2 text-muted-foreground hover:text-foreground" @click="backToPassword">
          <ArrowLeft class="size-4" aria-hidden="true" /> Retour
        </button>
        <button type="button" class="h-11 rounded-full px-2 font-medium text-primary hover:underline" @click="useRecovery = !useRecovery; code = ''; error = ''">
          {{ useRecovery ? 'Utiliser l’application' : 'Utiliser un code de secours' }}
        </button>
      </div>
    </form>

    <p class="mt-8 text-xs leading-relaxed text-muted-foreground">
      Ne saisissez jamais votre mot de passe sur une page reçue par e-mail. Le service informatique ne vous le demandera jamais.
    </p>
  </main>
</template>
