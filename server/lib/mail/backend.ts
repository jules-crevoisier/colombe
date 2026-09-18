/**
 * Interface commune aux deux implémentations :
 *   - ImapBackend  (imapflow + nodemailer, serveur réel)
 *   - MockBackend  (mémoire, pour le dev et les tests — aucun réseau)
 *
 * Les backends manipulent des messages BRUTS (RFC 822). Le parsing et
 * l'assainissement sont communs (parse.ts / sanitize.ts), donc le mock
 * exerce exactement le même chemin de rendu que la prod.
 */
import type { Folder, MessageSummary } from '#shared/types/mail'

export interface MailCredentials {
  email: string
  password: string
}

export interface ListOptions {
  page: number
  pageSize: number
  /** Recherche plein texte (sujet, expéditeur, destinataires, corps). */
  query?: string
}

export interface ListResult {
  items: MessageSummary[]
  total: number
}

export interface FlagChange {
  seen?: boolean
  flagged?: boolean
}

export interface SendEnvelope {
  from: string
  to: string[]
}

export interface StoredMessage {
  raw: Buffer
  seen: boolean
  flagged: boolean
  size: number
}

export interface MailBackend {
  listFolders(): Promise<Folder[]>
  /** Tri : date décroissante. Page 1 = plus récents. */
  listMessages(folder: string, opts: ListOptions): Promise<ListResult>
  /** Source RFC 822 brute. Lève MailError('NOT_FOUND') si absent. */
  getRawMessage(folder: string, uid: number): Promise<Buffer>
  /** Source brute + drapeaux, pour l'affichage d'un message. */
  getMessage(folder: string, uid: number): Promise<StoredMessage>
  setFlags(folder: string, uids: number[], change: FlagChange): Promise<void>
  move(folder: string, uids: number[], destination: string): Promise<void>
  /** Suppression définitive (flag \Deleted + expunge). */
  expunge(folder: string, uids: number[]): Promise<void>
  /** Ajoute un message brut, renvoie l'UID attribué si connu. */
  append(folder: string, raw: Buffer, flags: string[]): Promise<number | null>
  /** Envoi SMTP d'un message brut. */
  send(raw: Buffer, envelope: SendEnvelope): Promise<void>
  close(): Promise<void>

  // ─── v2 ───
  /** Crée un dossier (chemin complet, délimiteur du serveur). Lève INVALID si déjà existant. */
  createFolder(path: string): Promise<void>
  renameFolder(path: string, newPath: string): Promise<void>
  /** Supprime un dossier personnel. Lève INVALID pour INBOX et les dossiers spéciaux. */
  deleteFolder(path: string): Promise<void>
  /**
   * UIDs des messages dont l'en-tête contient la valeur (recherche IMAP HEADER).
   * Sert à reconstituer les conversations (Message-ID / References).
   */
  searchHeader(folder: string, header: 'message-id' | 'references' | 'in-reply-to', value: string): Promise<number[]>
  /** Résumés pour une liste d'UIDs (ordre non garanti, UIDs absents ignorés). */
  summaries(folder: string, uids: number[]): Promise<MessageSummary[]>
}

export type MailErrorCode = 'AUTH_FAILED' | 'NOT_FOUND' | 'INVALID' | 'UNAVAILABLE'

export class MailError extends Error {
  constructor(public readonly code: MailErrorCode, message: string) {
    super(message)
    this.name = 'MailError'
  }
}

export interface MailServerConfig {
  host: string
  imapPort: number
  imapSecure: boolean
  smtpPort: number
  smtpRequireTls: boolean
}
