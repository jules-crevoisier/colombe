<script setup lang="ts">
import { ArrowLeft, Eye, EyeOff, LoaderCircle, ShieldCheck } from '@lucide/vue'
import type { LoginResult } from '#shared/types/mail'

definePageMeta({ layout: 'auth' })

const { config, addressExample } = useSiteConfig()
useHead({ title: computed(() => `Connexion — ${config.value.productName}`) })

const emailLabel = computed(() => (config.value.login.defaultDomain ? 'Adresse e-mail ou identifiant' : 'Adresse e-mail'))
const emailInputType = computed(() => (config.value.login.defaultDomain ? 'text' : 'email'))
const loginMessage = computed(() => config.value.loginMessage || (config.value.orgName ? `Messagerie ${config.value.orgName}` : ''))
const supportHref = computed(() => config.value.supportUrl ?? (config.value.supportEmail ? `mailto:${config.value.supportEmail}` : null))
const demo = computed(() => config.value.demo)
const demoDescription = computed(() => `Un compte de démonstration est créé pour vous, avec des messages d'exemple. Il est effacé au bout de ${demo.value?.ttlHours ?? 4} heures. Aucun e-mail ne quitte ce serveur.`)

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

function describeDemo(err: unknown): string {
  const status = statusOf(err)
  if (status === 429) return errorText(err)
  return 'Impossible de créer la démonstration pour le moment. Réessayez plus tard.'
}

async function tryDemo() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await $fetch<LoginResult>('/api/auth/demo', { method: 'POST' })
    await finish()
  }
  catch (err) {
    error.value = describeDemo(err)
  }
  finally {
    loading.value = false
  }
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
  <div class="grid min-h-[100dvh] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <!-- Bureau : le panneau « nuit », la colombe en vol. -->
    <div class="relative hidden flex-col justify-between overflow-hidden bg-[radial-gradient(120%_90%_at_20%_10%,#27479f_0%,#1f3a8a_35%,#0d1324_100%)] p-12 text-[#ece8de] lg:flex xl:p-16">
      <div class="flex items-center gap-3">
        <BrandLogo class="size-10 rounded-[10px] ring-1 ring-white/20" />
        <span class="font-heading text-[26px] leading-none font-semibold tracking-[-0.01em]">Colombe</span>
      </div>
      <div class="flex flex-col gap-10">
        <BrandDove class="w-full max-w-[520px] [--dove-trail:rgb(236_232_222/0.35)]" />
        <p class="max-w-md font-heading text-[40px] leading-[1.1] font-normal tracking-[-0.02em] text-balance xl:text-[46px]">
          Votre courrier, <em class="text-[#f59e6b] italic">plié avec soin</em>.
        </p>
      </div>
      <div v-if="config.hasLogo || config.orgName" class="flex items-center gap-2 text-sm text-[#ece8de]/75">
        <img v-if="config.hasLogo" :src="apiUrl('/api/branding/logo')" :alt="config.orgName || config.productName" class="h-6 w-auto shrink-0">
        <span v-if="config.orgName">{{ config.orgName }}</span>
      </div>
    </div>

  <main class="flex items-center justify-center px-5 py-10 sm:px-10">
   <div class="w-full max-w-[400px] animate-settle">
    <div class="mb-8 flex flex-col items-start gap-5">
      <span v-if="step === 'code'" class="grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground" aria-hidden="true">
        <ShieldCheck class="size-6" />
      </span>
      <div v-else class="flex items-center gap-3 lg:hidden">
        <BrandLogo class="size-12 shrink-0" :label="config.productName" />
        <!-- Sur mobile, le panneau de gauche est masqué : l'établissement reste identifiable. -->
        <div v-if="config.hasLogo || config.orgName" class="flex min-w-0 items-center gap-2 border-l border-border pl-3 text-sm text-muted-foreground">
          <img v-if="config.hasLogo" :src="apiUrl('/api/branding/logo')" :alt="config.orgName || config.productName" class="h-6 w-auto shrink-0">
          <span v-if="config.orgName" class="min-w-0">{{ config.orgName }}</span>
        </div>
      </div>
      <div>
        <h1 class="font-heading text-[34px] leading-[1.1] font-medium tracking-[-0.02em] sm:text-[40px]">{{ step === 'code' ? 'Validation en deux étapes' : 'Connexion' }}</h1>
        <p class="mt-3 text-base text-muted-foreground">
          <template v-if="step === 'code'">
            {{ useRecovery ? 'Saisissez l’un de vos codes de secours.' : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.' }}
          </template>
          <template v-else-if="loginMessage">{{ loginMessage }}</template>
        </p>
      </div>
    </div>

    <div v-if="demo && step === 'password'" class="flex flex-col gap-5">
      <p class="text-sm text-muted-foreground">{{ demoDescription }}</p>
      <p id="login-error" class="min-h-5 text-sm text-destructive" role="alert" aria-live="assertive">{{ error }}</p>
      <Button type="button" class="h-12 w-full rounded-lg text-base font-semibold" :disabled="loading" @click="tryDemo">
        <LoaderCircle v-if="loading" class="size-5 animate-spin" aria-hidden="true" />
        {{ loading ? 'Création de la démo…' : 'Essayer la démo' }}
      </Button>
    </div>

    <form v-else-if="step === 'password'" class="flex flex-col gap-5" novalidate @submit.prevent="submitPassword">
      <div class="flex flex-col gap-2">
        <Label for="email">{{ emailLabel }}</Label>
        <Input id="email" v-model="email" :type="emailInputType" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" :placeholder="addressExample" required class="h-12 rounded-lg text-base" :aria-invalid="!!error || undefined" aria-describedby="login-error" />
      </div>

      <div class="flex flex-col gap-2">
        <Label for="password">Mot de passe</Label>
        <div class="relative">
          <Input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required class="h-12 rounded-lg pr-12 text-base" :aria-invalid="!!error || undefined" aria-describedby="login-error" />
          <button type="button" class="absolute top-0.5 right-0.5 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" :aria-label="showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'" :aria-pressed="showPassword" @click="showPassword = !showPassword">
            <component :is="showPassword ? EyeOff : Eye" class="size-5" aria-hidden="true" />
          </button>
        </div>
        <a v-if="config.passwordResetUrl" :href="config.passwordResetUrl" target="_blank" rel="noopener noreferrer" class="self-start text-sm font-medium text-primary hover:underline">Mot de passe oublié ?</a>
      </div>

      <p id="login-error" class="min-h-5 text-sm text-destructive" role="alert" aria-live="assertive">{{ error }}</p>

      <Button type="submit" class="h-12 w-full rounded-lg text-base font-semibold" :disabled="loading || !email || !password">
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

      <Button type="submit" class="h-12 w-full rounded-lg text-base font-semibold" :disabled="loading || code.trim().length < 6">
        <LoaderCircle v-if="loading" class="size-5 animate-spin" aria-hidden="true" />
        {{ loading ? 'Vérification…' : 'Valider' }}
      </Button>

      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" class="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" @click="backToPassword">
          <ArrowLeft class="size-4" aria-hidden="true" /> Retour
        </button>
        <button type="button" class="h-11 rounded-lg px-2 font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring" @click="useRecovery = !useRecovery; code = ''; error = ''">
          {{ useRecovery ? 'Utiliser l’application' : 'Utiliser un code de secours' }}
        </button>
      </div>
    </form>

    <div class="mt-8 flex gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3">
      <ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p class="text-xs leading-relaxed text-muted-foreground">
        Ne saisissez jamais votre mot de passe sur une page reçue par e-mail. Le service informatique ne vous le demandera jamais.
      </p>
    </div>

    <p v-if="supportHref" class="mt-4 text-center text-xs">
      <a :href="supportHref" target="_blank" rel="noopener noreferrer" class="text-muted-foreground hover:text-foreground hover:underline">Besoin d'aide ?</a>
    </p>
   </div>
  </main>
  </div>
</template>
