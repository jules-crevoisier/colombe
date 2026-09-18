import type { MailBackend, MailCredentials, MailServerConfig } from './backend'
import { MockBackend, verifyMockCredentials } from './mock'
import { ImapBackend, verifyImapCredentials } from './imap'

export type BackendKind = 'imap' | 'mock'

export function createBackend(
  kind: BackendKind,
  creds: MailCredentials,
  config: MailServerConfig
): MailBackend {
  if (kind === 'mock') {
    return new MockBackend(creds.email)
  } else if (kind === 'imap') {
    return new ImapBackend(creds, config)
  }
  throw new Error(`Unknown backend kind: ${kind}`)
}

export async function verifyCredentials(
  kind: BackendKind,
  creds: MailCredentials,
  config: MailServerConfig
): Promise<boolean> {
  if (kind === 'mock') {
    return verifyMockCredentials(creds)
  } else if (kind === 'imap') {
    return verifyImapCredentials(creds, config)
  }
  return false
}
