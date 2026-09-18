import type { LiveEvent } from '#shared/types/mail'

/**
 * Mises à jour en direct : écoute /api/events (SSE). À chaque changement de
 * boîte, recharge les compteurs et signale la liste ouverte. Notification du
 * bureau pour un nouveau message si l'utilisateur l'a activée et que l'onglet
 * est en arrière-plan. EventSource se reconnecte seul après une coupure.
 */
export function useLiveUpdates() {
  const mail = useMailStore()
  const prefs = usePrefsStore()
  let source: EventSource | null = null

  async function onChange(folder: string) {
    const before = mail.inboxUnread
    await mail.loadFolders()
    mail.notifyChange(folder)
    const gained = mail.inboxUnread - before
    if (
      gained > 0
      && prefs.prefs.desktopNotifications
      && document.visibilityState === 'hidden'
      && 'Notification' in window
      && Notification.permission === 'granted'
    ) {
      // Pas de contenu du message dans la notification : elle peut s'afficher écran verrouillé.
      const n = new Notification('Webmail MMI', {
        body: gained > 1 ? `${gained} nouveaux messages` : 'Nouveau message',
        tag: 'webmail-nouveau',
      })
      n.onclick = () => {
        window.focus()
        void navigateTo('/mail/INBOX')
        n.close()
      }
    }
  }

  onMounted(() => {
    if (!('EventSource' in window)) return
    source = new EventSource('/api/events')
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        const ev = JSON.parse(e.data) as LiveEvent
        if (ev.type === 'mailbox') void onChange(ev.folder)
      }
      catch {
        // Message illisible : ignoré.
      }
    }
  })

  onBeforeUnmount(() => {
    source?.close()
    source = null
  })
}
