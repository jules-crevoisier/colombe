/**
 * Server-Sent Events : pousse au client les changements de ses boîtes.
 * Authentifié par la session ; une connexion IMAP IDLE partagée par session (backend réel).
 */
import { createEventStream } from 'h3'
import type { LiveEvent } from '#shared/types/mail'
import { onMailboxChange } from '../lib/live/bus'
import { inboxWatcher } from '../lib/live/watcher'
import { credentialsStore } from '../lib/session/credentials'
import { mailConfig, mailError, requireMail } from '../utils/mail-session'

export default defineEventHandler(async (event) => {
  let session
  try {
    session = await requireMail(event)
  }
  catch (err) {
    throw mailError(err, event)
  }

  const { kind, server } = mailConfig(event)
  const stream = createEventStream(event)
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })

  const send = (ev: LiveEvent) => {
    void stream.push(JSON.stringify(ev)).catch(() => {})
  }

  let watching = false
  if (kind === 'imap') {
    const creds = credentialsStore.get(session.sid)
    if (creds) {
      try {
        await inboxWatcher.acquire(session.sid, creds, server)
        watching = true
      }
      catch {
        // Limite de connexions atteinte ou serveur injoignable : le client
        // retombe sur le rafraîchissement périodique, sans erreur.
      }
    }
  }

  const unsubscribe = onMailboxChange(session.email, change => send({ type: 'mailbox', folder: change.folder }))
  const ping = setInterval(() => send({ type: 'ping' }), 25_000)

  stream.onClosed(() => {
    clearInterval(ping)
    unsubscribe()
    if (watching) inboxWatcher.release(session.sid)
  })

  send({ type: 'ping' })
  return stream.send()
})
