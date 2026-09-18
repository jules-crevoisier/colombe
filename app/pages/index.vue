<script setup lang="ts">
// La racine redirige vers la boîte de réception (ou /login, via le middleware global).
await navigateTo('/mail/INBOX', { replace: true })
</script>

<template>
  <div />
</template>
