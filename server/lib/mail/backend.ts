/**
 * Interface commune aux deux implémentations :
 *   - ImapBackend  (imapflow + nodemailer, serveur réel)
 *   - MockBackend  (mémoire, pour le dev et les tests — aucun réseau)
 *
 * Les backends manipulent des messages BRUTS (RFC 822). Le parsing et
 * l'assainissement sont communs (parse.ts / sanitize.ts), donc le mock
 * exerce exactement le même chemin de rendu que la prod.
 */
import type { Folder, FolderSize, MessageSummary, QuotaInfo, SearchField, SortKey } from '#shared/types/mail'
import type { MailSsoConfig } from '../config'

/** Options de `listFolders` : `all: true` inclut les dossiers non abonnés (R2.4). */
export interface ListFoldersOptions {
  all?: boolean
}

/**
 * Comment Colombe s'authentifie auprès d'IMAP/SMTP/ManageSieve pour une session.
 * Jamais envoyé au navigateur : vit uniquement en mémoire serveur (credentials.ts).
 *   - password : connexion par mot de passe (comportement historique) ;
 *   - oauth2   : connexion unique OIDC, jeton d'accès présenté en SASL XOAUTH2/OAUTHBEARER.
 *                L'objet est MUTÉ en place au rafraîchissement (credentials.ts) : un backend
 *                qui garde une référence reconnecte toujours avec le jeton courant ;
 *   - master   : connexion unique OIDC, utilisateur maître Dovecot (config MAIL_MASTER_*).
 */
export type MailAuth =
  | { kind: 'password'; password: string }
  | { kind: 'oauth2'; accessToken: string; refreshToken?: string; expiresAt: number }
  | { kind: 'master' }

export interface MailCredentials {
  email: string
  auth: MailAuth
}

export interface ListOptions {
  page: number
  pageSize: number
  /** Recherche plein texte. Par défaut sur tous les champs, sinon sur `fields`. */
  query?: string
  fields?: SearchField[]
  filters?: {
    unread?: boolean
    flagged?: boolean
    unanswered?: boolean
    /** Approximation IMAP : en-tête Content-Type multipart/mixed. */
    attachments?: boolean
    /** Date (AAAA-MM-JJ) incluse, sur la date interne du message. */
    since?: string
    /** Date (AAAA-MM-JJ) exclue. */
    before?: string
  }
  sort?: SortKey
  order?: 'asc' | 'desc'
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
  /** Accusé de remise (DSN) : NOTIFY=SUCCESS,FAILURE. */
  dsn?: boolean
}

export interface StoredMessage {
  raw: Buffer
  seen: boolean
  flagged: boolean
  size: number
  /** Tous les drapeaux et mots-clés IMAP (\Answered, $Forwarded, $MDNSent…). */
  flags: string[]
}

export interface MailBackend {
  /** Par défaut, ne renvoie que les dossiers abonnés ; `{ all: true }` renvoie tout (R2.4). */
  listFolders(opts?: ListFoldersOptions): Promise<Folder[]>
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

  // ─── R1 ───
  /** Copie (l'original reste). */
  copy(folder: string, uids: number[], destination: string): Promise<void>
  /** Ajoute / retire des drapeaux ou mots-clés IMAP arbitraires (\Answered, $Forwarded, $MDNSent). */
  setKeywords(folder: string, uids: number[], add: string[], remove: string[]): Promise<void>
  /** Tous les UIDs d'un dossier (pour « marquer tout comme lu », « vider »). */
  allUids(folder: string): Promise<number[]>

  // ─── R2.4 ───
  /** Abonne / désabonne un dossier (LSUB). */
  subscribeFolder(path: string, subscribed: boolean): Promise<void>
  /** Quota du compte (mesuré sur INBOX). `limitBytes: null` si le serveur ne fournit pas de quota. */
  getQuota(): Promise<QuotaInfo>
  /** Taille d'un dossier (octets + nombre de messages). */
  folderSize(path: string): Promise<FolderSize>
}

export type MailErrorCode = 'AUTH_FAILED' | 'NOT_FOUND' | 'INVALID' | 'UNAVAILABLE'

export class MailError extends Error {
  constructor(public readonly code: MailErrorCode, message: string) {
    super(message)
    this.name = 'MailError'
  }
}

export interface MailServerConfig {
  imapHost: string
  imapPort: number
  imapSecure: boolean
  /** Nom vérifié dans le certificat TLS IMAP (SNI + vérification), défaut : imapHost. */
  imapServername: string
  smtpHost: string
  smtpPort: number
  /** true : TLS implicite (465). false : STARTTLS (587). */
  smtpSecure: boolean
  smtpRequireTls: boolean
  /** Nom vérifié dans le certificat TLS SMTP, défaut : smtpHost. */
  smtpServername: string
  /** false uniquement en dev/tests contre un certificat auto-signé (interdit en production). */
  tlsRejectUnauthorized?: boolean
  /** Identifiant présenté au serveur : l'adresse complète ou la partie avant @ (voir ColombeConfig.login.username). */
  loginUsername: 'email' | 'localpart'
  /** Accès des sessions OIDC (ColombeConfig.mailSso) ; absent/null : sessions par mot de passe uniquement. */
  mailSso?: MailSsoConfig | null
}

/**
 * Identifiant présenté au serveur IMAP/SMTP pour une adresse — miroir de
 * `authUsername` (server/lib/config), réimplémenté ici pour que ce module
 * reste indépendant de server/lib/config (testable seul, sans variables
 * d'environnement).
 */
export function mailUsername(email: string, config: Pick<MailServerConfig, 'loginUsername'>): string {
  return config.loginUsername === 'localpart' ? email.slice(0, email.lastIndexOf('@')) : email
}
