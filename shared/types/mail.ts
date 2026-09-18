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
  /** Abonnement IMAP. Seul GET /api/folders?all=1 renvoie des dossiers non abonnés. */
  subscribed: boolean
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
  /** Drapeau IMAP \Answered. */
  answered: boolean
  /** Mot-clé IMAP $Forwarded. */
  forwarded: boolean
  /** D'après X-Priority / Importance. */
  priority: Priority
}

export type Priority = 'high' | 'normal' | 'low'

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
  /** Destinataire de l'accusé de lecture demandé, s'il n'a pas encore été envoyé ($MDNSent). */
  readReceiptTo: Address | null
  /** Adresse de l'en-tête List-Post (sans « mailto: »), null si ce n'est pas une liste. */
  listPost: string | null
  /** L'expéditeur est dans les contacts (ajoutés à la main OU collectés). */
  senderInContacts: boolean
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
  priority?: Priority
  requestReadReceipt?: boolean
  requestDeliveryReceipt?: boolean
  /** Messages joints tels quels (message/rfc822), nommés « {objet}.eml ». */
  forwardAsAttachment?: MessageRef[]
  /** Message d'origine : reçoit \Answered (réponse) ou $Forwarded (transfert) après envoi. */
  origin?: (MessageRef & { kind: 'reply' | 'forward' }) | null
  /** Identité d'envoi (R2.1). Absente : identité par défaut. */
  identityId?: number
}

export interface MessageRef {
  folder: string
  uid: number
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
  // ─── R2.4 / R2.5 / R2.6 / R2.7 ───
  /** Volet de lecture (ignoré sous 1024 px). */
  readingPane: 'none' | 'right'
  /** Secondes avant de marquer comme lu ; -1 = jamais automatiquement. */
  markReadDelay: 0 | 5 | 10 | -1
  preferHtml: boolean
  remoteImages: 'never' | 'contacts' | 'always'
  /** Fuseau IANA, ex. « Europe/Paris ». */
  timeZone: string
  dateFormat: 'relative' | 'short' | 'long'
  timeFormat: '24h' | '12h'
  replyPosition: 'above' | 'below'
  /** false = éditeur texte brut. */
  composeHtml: boolean
  logoutEmptyTrash: boolean
  logoutExpunge: boolean
  deleteMode: 'trash' | 'permanent'
  /** Chemins ; '' = détection automatique. */
  specialFolders: SpecialFolders
  /** Minutes d'inactivité avant la boîte « Toujours là ? ». */
  idleMinutes: 15 | 30 | 60 | 120
  /** Liste regroupée par conversation (une ligne par fil). */
  threadList: boolean
  /** La boîte « Bienvenue » (nom affiché) a été vue. */
  welcomed: boolean
}

export const DEFAULT_PREFS: Prefs = {
  signatureHtml: '',
  signatureEnabled: false,
  pageSize: 50,
  density: 'comfortable',
  undoSendSeconds: 5,
  conversationView: true,
  desktopNotifications: false,
  readingPane: 'right',
  markReadDelay: 0,
  preferHtml: true,
  remoteImages: 'never',
  timeZone: 'Europe/Paris',
  dateFormat: 'relative',
  timeFormat: '24h',
  replyPosition: 'above',
  composeHtml: true,
  logoutEmptyTrash: false,
  logoutExpunge: false,
  deleteMode: 'trash',
  specialFolders: { sent: '', drafts: '', trash: '', junk: '', archive: '' },
  idleMinutes: 60,
  threadList: false,
  welcomed: false,
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

// ─── R1 (parité Roundcube) ─────────────────────────────────────────────────

export type SearchField = 'subject' | 'from' | 'to' | 'cc' | 'body'
export type SortKey = 'date' | 'from' | 'subject' | 'size'

/** Paramètres de GET /api/messages (en plus de folder, page, pageSize). */
export interface MessageQuery {
  q?: string
  fields?: SearchField[]
  scope?: 'folder' | 'all'
  unread?: boolean
  flagged?: boolean
  unanswered?: boolean
  attachments?: boolean
  /** AAAA-MM-JJ inclus */
  since?: string
  /** AAAA-MM-JJ exclu */
  before?: string
  sort?: SortKey
  order?: 'asc' | 'desc'
}

export interface MessageSource {
  headers: Array<{ name: string; value: string }>
  /** Source brute, tronquée à 1 Mo. */
  source: string
}

export interface ImportResult {
  imported: number
}

// ─── R2 (parité Roundcube) ─────────────────────────────────────────────────

/**
 * Identité d'envoi. L'adresse d'expédition est TOUJOURS l'identifiant de connexion :
 * `email` est en lecture seule et n'est jamais pris depuis le client.
 */
export interface Identity {
  id: number
  /** Nom affiché dans « De ». */
  name: string
  /** Toujours l'adresse de connexion. */
  email: string
  /** Adresse « Répondre à » ('' = aucune). */
  replyTo: string
  /** Copie cachée automatique ('' = aucune). */
  bcc: string
  organization: string
  /** Signature HTML assainie ; peut contenir des images `data:image/(png|jpeg|gif)`. */
  signatureHtml: string
  isDefault: boolean
}

export type IdentityInput = Omit<Identity, 'id' | 'email'>

/** Réponse type (nom évitant le conflit avec `Response` du DOM). */
export interface CannedResponse {
  id: number
  name: string
  html: string
}

export type CannedResponseInput = Omit<CannedResponse, 'id'>

export type EmailLabel = 'home' | 'work' | 'other'
export type PhoneLabel = 'home' | 'work' | 'mobile' | 'other'

export interface PostalAddress {
  street: string
  postalCode: string
  city: string
  country: string
}

export interface ContactDetailInput {
  firstName: string
  lastName: string
  /** Vide = « Prénom Nom ». */
  displayName: string
  /** Au moins une adresse ; la première est l'adresse principale (`Contact.email`). */
  emails: Array<{ label: EmailLabel; address: string }>
  phones: Array<{ label: PhoneLabel; number: string }>
  organization: string
  jobTitle: string
  address: PostalAddress | null
  /** AAAA-MM-JJ */
  birthday: string | null
  notes: string
}

export interface ContactDetail extends Contact, ContactDetailInput {
  groupIds: number[]
}

export interface ContactGroup {
  id: number
  name: string
  memberCount: number
}

/** GET /api/contacts?q=…&withGroups=1 */
export interface ContactSearchResult {
  contacts: Contact[]
  groups: Array<{ id: number; name: string; emails: string[] }>
}

export interface ContactImportResult {
  imported: number
  skipped: number
}

export interface QuotaInfo {
  usedBytes: number
  /** null : le serveur ne fournit pas de quota. */
  limitBytes: number | null
}

export interface FolderSize {
  bytes: number
  messages: number
}

export interface SpecialFolders {
  sent: string
  drafts: string
  trash: string
  junk: string
  archive: string
}

export interface LoginEvent {
  /** ISO 8601 */
  at: string
  ip: string
  userAgent: string
  success: boolean
}

export interface AccountActivity {
  lastLogin: LoginEvent | null
  recent: LoginEvent[]
}

export interface ActiveSession {
  /** Identifiant opaque et masqué (jamais le sid réel). */
  id: string
  createdAt: string
  lastSeenAt: string
  ip: string
  userAgent: string
  current: boolean
}
