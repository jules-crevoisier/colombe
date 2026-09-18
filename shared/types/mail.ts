/**
 * Contrat partagé client ↔ serveur. Toute route /api renvoie ces formes.
 * Aucun champ ici ne doit jamais contenir d'identifiant ou de mot de passe.
 */

export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive'

export interface Folder {
  /** Chemin IMAP complet, ex. "INBOX" ou "INBOX.Projets". Sert d'identifiant. */
  path: string
  /** Nom affichable (dernier segment, ou libellé FR pour les dossiers spéciaux). */
  name: string
  specialUse: SpecialUse | null
  delimiter: string
  unread: number
  total: number
}

export interface Address {
  name: string
  address: string
}

export interface MessageSummary {
  uid: number
  folder: string
  subject: string
  from: Address | null
  to: Address[]
  /** ISO 8601 */
  date: string
  seen: boolean
  flagged: boolean
  hasAttachments: boolean
  /** Extrait texte brut, ≤ 200 caractères, sans HTML. */
  preview: string
  size: number
}

export interface MessagePage {
  items: MessageSummary[]
  total: number
  page: number
  pageSize: number
}

export interface AttachmentMeta {
  /** Identifiant opaque de la pièce jointe dans le message (index stable). */
  id: string
  filename: string
  contentType: string
  size: number
}

export interface MessageDetail extends MessageSummary {
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  /** HTML DÉJÀ assaini par DOMPurify côté serveur, images distantes neutralisées. */
  html: string | null
  text: string | null
  /** Nombre d'images distantes neutralisées dans `html`. */
  remoteImages: number
  attachments: AttachmentMeta[]
}

export interface ComposeAttachment {
  filename: string
  contentType: string
  /** Contenu encodé en base64. */
  content: string
}

export interface ComposePayload {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  /** Corps en texte brut (toujours fourni : partie text/plain). */
  text: string
  /** Corps HTML de l'éditeur riche. Ré-assaini côté serveur avant envoi. */
  html?: string | null
  inReplyTo?: string | null
  references?: string[]
  attachments?: ComposeAttachment[]
  /** UID d'un brouillon existant (dossier Brouillons) à remplacer / supprimer après envoi. */
  draftUid?: number | null
}

export interface DraftSaveResult {
  uid: number | null
}

export interface SessionUserData {
  email: string
}

export interface ApiErrorBody {
  statusCode: number
  message: string
}

// ─── v2 ────────────────────────────────────────────────────────────────────

/** Préférences utilisateur (stockées en SQLite côté serveur). */
export interface Prefs {
  /** Signature HTML (assainie côté serveur à l'enregistrement). Vide = aucune. */
  signatureHtml: string
  signatureEnabled: boolean
  pageSize: 25 | 50 | 100
  density: 'comfortable' | 'compact'
  /** Délai d'annulation de l'envoi, en secondes. 0 = désactivé. */
  undoSendSeconds: 0 | 5 | 10 | 20
  conversationView: boolean
  desktopNotifications: boolean
}

export const DEFAULT_PREFS: Prefs = {
  signatureHtml: '',
  signatureEnabled: false,
  pageSize: 50,
  density: 'comfortable',
  undoSendSeconds: 5,
  conversationView: true,
  desktopNotifications: false,
}

export interface Contact {
  id: number
  email: string
  name: string
  /** true = ajouté à la main ; false = collecté automatiquement à l'envoi. */
  manual: boolean
  /** Nombre d'envois vers ce contact (tri de l'autocomplétion). */
  timesContacted: number
  /** ISO 8601 */
  lastContactedAt: string | null
}

export interface ContactInput {
  email: string
  name: string
}

/** Messages d'une même conversation, du plus ancien au plus récent. */
export interface ThreadResult {
  items: MessageSummary[]
}

export interface TwoFactorStatus {
  enabled: boolean
  recoveryCodesLeft: number
}

export interface TwoFactorSetup {
  /** URI otpauth:// (à afficher en QR code). */
  otpauthUri: string
  /** QR code SVG généré côté serveur (aucun service externe). */
  qrSvg: string
  /** Secret en base32, pour saisie manuelle. */
  secret: string
}

export interface LoginResult {
  user?: { email: string }
  /** true : mot de passe correct, code TOTP attendu sur /api/auth/2fa. */
  twoFactorRequired?: boolean
}

/** Événements poussés par /api/events (SSE). */
export type LiveEvent =
  | { type: 'mailbox'; folder: string }
  | { type: 'ping' }
