/**
 * Bus d'événements « boîte modifiée », par utilisateur. Alimenté par IMAP IDLE
 * (backend réel) ou directement par le backend mémoire ; consommé par /api/events (SSE).
 */
import { EventEmitter } from 'node:events'

const bus = new EventEmitter()
bus.setMaxListeners(0)

export interface MailboxChange {
  owner: string
  folder: string
}

export function publishMailboxChange(owner: string, folder: string): void {
  bus.emit('mailbox', { owner: owner.toLowerCase(), folder } satisfies MailboxChange)
}

/** Abonnement aux changements d'un utilisateur ; renvoie la fonction de désabonnement. */
export function onMailboxChange(owner: string, listener: (change: MailboxChange) => void): () => void {
  const key = owner.toLowerCase()
  const handler = (change: MailboxChange) => {
    if (change.owner === key) listener(change)
  }
  bus.on('mailbox', handler)
  return () => bus.off('mailbox', handler)
}
