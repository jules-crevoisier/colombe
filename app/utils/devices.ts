/**
 * Onglet « Autres applications » : textes des guides pas à pas, remplis avec les
 * vrais paramètres de l'utilisateur. Fonctions pures (testées dans tests/unit/ui).
 */
import type { ClientSecurity, DeviceSettings } from '#shared/types/config'

export type DeviceApp = 'gmail' | 'apple' | 'outlook' | 'thunderbird' | 'other'

export const DEVICE_APPS: ReadonlyArray<{ value: DeviceApp; label: string }> = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'apple', label: 'iPhone / iPad' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'thunderbird', label: 'Thunderbird' },
  { value: 'other', label: 'Autre application' },
]

/** Valeur à recopier dans l'application, affichée avec un bouton « Copier ». */
export interface GuideValue {
  label: string
  value: string
}

export interface GuideStep {
  /** Texte de l'étape ; les libellés d'interface sont entre « guillemets ». */
  text: string
  values?: GuideValue[]
}

type Server = NonNullable<DeviceSettings['imap']>

/** Serveurs publiés : les guides ne s'affichent que si les deux sont connus. */
export interface ReadyDeviceSettings extends DeviceSettings {
  imap: Server
  smtp: Server
}

export function hasPublicServers(s: DeviceSettings): s is ReadyDeviceSettings {
  return s.imap !== null && s.smtp !== null
}

export function clientSecurityLabel(security: ClientSecurity): string {
  return security === 'ssl' ? 'SSL/TLS' : 'STARTTLS'
}

/**
 * Découpe un texte d'étape pour mettre en valeur les libellés « entre guillemets ».
 * Les espaces intérieures des guillemets deviennent insécables : « Suivant » ne se coupe jamais avant ».
 */
export function splitQuoted(text: string): Array<{ text: string; quoted: boolean }> {
  return text.split(/(«[^»]*»)/).filter(Boolean).map((part) => {
    const quoted = part.startsWith('«')
    return { text: quoted ? part.replace(/^« /, '« ').replace(/ »$/, ' »') : part, quoted }
  })
}

function serverValues(s: Server, username: string, securityName = 'Sécurité'): GuideValue[] {
  return [
    { label: 'Serveur', value: s.host },
    { label: 'Port', value: String(s.port) },
    { label: securityName, value: clientSecurityLabel(s.security) },
    { label: 'Identifiant', value: username },
  ]
}

/** Application Gmail (Android ou iPhone), compte « Personnel (IMAP) ». */
export function gmailAppSteps(s: ReadyDeviceSettings): GuideStep[] {
  return [
    { text: 'Ouvrez l\'application Gmail, puis le menu → « Paramètres » → « Ajouter un compte ».' },
    { text: 'Choisissez « Autre ».' },
    { text: 'Saisissez votre adresse, puis touchez « Suivant ».', values: [{ label: 'Adresse', value: s.email }] },
    { text: 'Choisissez « Personnel (IMAP) ».' },
    { text: 'Saisissez le mot de passe de votre messagerie, puis touchez « Suivant ».' },
    { text: 'Paramètres du serveur entrant :', values: serverValues(s.imap, s.username, 'Type de sécurité') },
    { text: 'Paramètres du serveur sortant (laissez « Exiger une connexion » activé) :', values: serverValues(s.smtp, s.username, 'Type de sécurité') },
    { text: 'Choisissez la fréquence de synchronisation, puis touchez « Suivant ». Votre messagerie apparaît dans Gmail.' },
  ]
}

/** Gmail sur ordinateur : « Envoyer des e-mails en tant que » avec le serveur d'envoi de l'établissement. */
export function gmailSendAsSteps(s: ReadyDeviceSettings): GuideStep[] {
  const tls = s.smtp.security === 'ssl' ? '« Connexion sécurisée via SSL »' : '« Connexion sécurisée via TLS »'
  return [
    { text: 'Dans Gmail sur ordinateur : « Paramètres » (roue dentée) → « Voir tous les paramètres » → onglet « Comptes et importation ».' },
    { text: 'À la ligne « Envoyer des e-mails en tant que », choisissez « Ajouter une autre adresse e-mail », puis saisissez votre adresse.', values: [{ label: 'Adresse', value: s.email }] },
    {
      text: `Serveur SMTP : saisissez ces valeurs, le mot de passe de votre messagerie, et choisissez ${tls}.`,
      values: [
        { label: 'Serveur SMTP', value: s.smtp.host },
        { label: 'Port', value: String(s.smtp.port) },
        { label: 'Nom d\'utilisateur', value: s.username },
      ],
    },
    { text: `Gmail envoie un code de confirmation à votre adresse : ouvrez-le dans ${s.productName} et saisissez le code dans Gmail.` },
  ]
}

/** iPhone / iPad : installation du profil de configuration téléchargé. */
export function appleProfileSteps(s: ReadyDeviceSettings): GuideStep[] {
  return [
    { text: 'Sur l\'iPhone ou l\'iPad, ouvrez cette page dans Safari et touchez « Télécharger le profil de configuration ». Si Safari le demande, touchez « Autoriser ».' },
    { text: 'Ouvrez l\'app Réglages et touchez « Profil téléchargé » en haut de la liste, puis « Installer ».' },
    { text: `iOS indique « Non signé » : c'est normal. Le profil est créé par ${s.productName} pour votre compte et ne contient pas votre mot de passe.` },
    { text: 'Saisissez le mot de passe de votre messagerie quand il est demandé, puis touchez « Suivant » et « OK ».' },
    { text: 'Votre messagerie apparaît dans l\'app Mail.' },
  ]
}

/** iPhone / iPad : ajout manuel du compte. */
export function appleManualSteps(s: ReadyDeviceSettings): GuideStep[] {
  return [
    { text: 'Ouvrez Réglages → « Apps » → « Mail » → « Comptes mail » → « Ajouter un compte » (sur les versions plus anciennes : Réglages → « Mail » → « Comptes »).' },
    { text: 'Choisissez « Autre », puis « Ajouter un compte Mail ».' },
    { text: 'Saisissez votre nom, votre adresse et le mot de passe de votre messagerie, puis touchez « Suivant ».', values: [{ label: 'Adresse', value: s.email }] },
    { text: 'Choisissez « IMAP ». Serveur de réception :', values: [{ label: 'Nom d\'hôte', value: s.imap.host }, { label: 'Nom d\'utilisateur', value: s.username }] },
    { text: 'Serveur d\'envoi (même mot de passe), puis « Suivant » et « Enregistrer » :', values: [{ label: 'Nom d\'hôte', value: s.smtp.host }, { label: 'Nom d\'utilisateur', value: s.username }] },
    {
      text: 'Si la connexion échoue, vérifiez les ports dans les réglages avancés du compte (« Utiliser SSL » activé) :',
      values: [{ label: 'Port de réception', value: String(s.imap.port) }, { label: 'Port d\'envoi', value: String(s.smtp.port) }],
    },
  ]
}

export function outlookSteps(s: ReadyDeviceSettings): GuideStep[] {
  return [
    { text: 'Dans Outlook, ouvrez « Ajouter un compte » (menu « Fichier », ou « Paramètres » → « Comptes »).' },
    { text: 'Saisissez votre adresse, puis « Continuer ».', values: [{ label: 'Adresse', value: s.email }] },
    { text: 'Si Outlook ne trouve pas les paramètres tout seul ou propose un autre type de compte, choisissez « IMAP ».' },
    { text: 'Courrier entrant :', values: serverValues(s.imap, s.username, 'Méthode de chiffrement') },
    { text: 'Courrier sortant :', values: serverValues(s.smtp, s.username, 'Méthode de chiffrement') },
    { text: 'Saisissez le mot de passe de votre messagerie, puis « Continuer ».' },
  ]
}

export function thunderbirdSteps(s: ReadyDeviceSettings): GuideStep[] {
  return [
    { text: 'Dans Thunderbird : menu → « Nouveau » → « Compte courrier existant ».' },
    { text: 'Saisissez votre nom, votre adresse et le mot de passe de votre messagerie, puis « Continuer ».', values: [{ label: 'Adresse', value: s.email }] },
    { text: 'Thunderbird trouve en général les paramètres tout seul. Vérifiez que « IMAP » est choisi, puis cliquez sur « Terminé ».' },
    { text: 'Sinon, cliquez sur « Configurer manuellement ». Serveur entrant (IMAP) :', values: serverValues(s.imap, s.username, 'SSL') },
    { text: 'Serveur sortant (SMTP), avec l\'authentification « Mot de passe normal » :', values: serverValues(s.smtp, s.username, 'SSL') },
  ]
}

export function otherAppSteps(): GuideStep[] {
  return [
    { text: 'Ajoutez un compte de type « IMAP » (pas « POP », ni « Exchange »).' },
    { text: 'Recopiez les paramètres ci-dessous. Authentification : « Mot de passe normal », avec le mot de passe de votre messagerie.' },
  ]
}

/** Le transfert automatique vers une adresse Gmail est-il autorisé par l'établissement ? */
export function canForwardToGmail(forwardDomains: readonly string[]): boolean {
  return forwardDomains.some(d => d.toLowerCase() === 'gmail.com')
}

/** ['@a.fr', '@b.fr'] : chaque domaine s'affiche sans coupure (pas de retour à la ligne au tiret). */
export function formatDomains(domains: readonly string[]): string[] {
  return domains.map(d => `@${d}`)
}

/** Exemple d'adresse de transfert construit à partir du premier domaine autorisé. */
export function forwardPlaceholder(forwardDomains: readonly string[]): string {
  return `destinataire@${forwardDomains[0] ?? 'exemple.fr'}`
}

/** Application proposée d'abord selon l'appareil utilisé. */
export function defaultDeviceApp(userAgent: string, maxTouchPoints = 0): DeviceApp {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'apple'
  return 'gmail'
}
