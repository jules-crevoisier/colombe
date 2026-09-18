export default defineNuxtRouteMiddleware(async (to) => {
  const session = useUserSession()
  if (!session.ready.value) await session.fetch()

  if (!session.loggedIn.value) {
    return to.path === '/login' ? undefined : navigateTo('/login')
  }
  if (to.path === '/login' || to.path === '/') {
    return navigateTo('/mail/INBOX')
  }
})
