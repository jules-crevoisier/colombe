/**
 * Tests d'intégration du gestionnaire IMAP IDLE contre GreenMail.
 * Vérifie que les événements IMAP sont capturés et publiés sur le bus.
 */
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import nodemailer from 'nodemailer'
import type { MailServerConfig } from '../../server/lib/mail/backend'
import { InboxWatcher } from '../../server/lib/live/watcher'
import { onMailboxChange, publishMailboxChange } from '../../server/lib/live/bus'

const config: MailServerConfig = {
  imapHost: '127.0.0.1',
  imapPort: 3143,
  imapSecure: false,
  imapServername: '127.0.0.1',
  smtpHost: '127.0.0.1',
  smtpPort: 3025,
  smtpSecure: false,
  smtpRequireTls: false,
  smtpServername: '127.0.0.1',
  loginUsername: 'email',
}
const dev = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const alice = { email: 'alice@mmi-troyes.fr', password: 'alice-password' }

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(3143, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

describe.skipIf(!reachable)('InboxWatcher with GreenMail', () => {
  let watcher: InboxWatcher

  beforeAll(() => {
    watcher = new InboxWatcher({ gracePeriodMs: 100 })
  })

  afterAll(async () => {
    await watcher.closeAll()
  })

  it('should receive mailbox change events when a message arrives', async () => {
    const sid = `sid-${Date.now()}`
    await watcher.acquire(sid, dev, config)

    const events: string[] = []
    const unsubscribe = onMailboxChange(dev.email, (change) => {
      events.push(change.folder)
    })

    // Send a message to dev@mmi-troyes.fr via SMTP
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: false,
      requireTLS: false,
      auth: { user: alice.email, pass: alice.password },
    })

    try {
      await transporter.sendMail({
        from: alice.email,
        to: dev.email,
        subject: `Test message ${Date.now()}`,
        text: 'Test body',
      })

      // Wait for event (up to 10 seconds)
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline && events.length === 0) {
        await new Promise(r => setTimeout(r, 100))
      }

      expect(events).toContain('INBOX')
    }
    finally {
      transporter.close()
      unsubscribe()
      watcher.release(sid)
    }
  })
})
