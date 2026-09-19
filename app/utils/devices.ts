/**
 * Onglet « Autres applications » : textes des guides pas à pas, remplis avec les
 * vrais paramètres de l'utilisateur. Fonctions pures (testées dans tests/unit/ui).
 *
 * Les textes sont produits à l'appel (i18n.global.t), jamais mis en cache dans des
 * constantes de module : ils doivent suivre un changement de langue.
 */
import type { ClientSecurity, DeviceSettings } from '#shared/types/config'
import { i18n } from '~/lib/i18n'

export type DeviceApp = 'gmail' | 'apple' | 'outlook' | 'thunderbird' | 'other'

export const DEVICE_APPS: ReadonlyArray<{ value: DeviceApp; labelKey: string }> = [
  { value: 'gmail', labelKey: 'devices.apps.gmail' },
  { value: 'apple', labelKey: 'devices.apps.apple' },
  { value: 'outlook', labelKey: 'devices.apps.outlook' },
  { value: 'thunderbird', labelKey: 'devices.apps.thunderbird' },
  { value: 'other', labelKey: 'devices.apps.other' },
]

/** Valeur à recopier dans l'application, affichée avec un bouton « Copier ». */
export interface GuideValue {
  label: string
  value: string
}

export interface GuideStep {
  /** Texte de l'étape ; les libellés d'interface sont entre « guillemets » (fr) ou "guillemets" (en). */
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
 * Découpe un texte d'étape pour mettre en valeur les libellés entre « guillemets »
 * (français) ou "guillemets droits" (anglais). Les espaces intérieures des
 * guillemets français deviennent insécables : « Suivant » ne se coupe jamais avant ».
 */
export function splitQuoted(text: string): Array<{ text: string; quoted: boolean }> {
  return text.split(/(«[^»]*»|"[^"]*")/).filter(Boolean).map((part) => {
    // Espace insécable à l'intérieur des guillemets français : « Suivant » ne se coupe jamais avant ».
    const withNbsp = part.replace(/^(«) /, '$1 ').replace(/ (»)$/, ' $1')
    return { text: withNbsp, quoted: /^[«"]/.test(part) }
  })
}

function serverValues(s: Server, username: string, securityName = i18n.global.t('devices.guides.common.securityLabel')): GuideValue[] {
  return [
    { label: i18n.global.t('devices.guides.common.serverLabel'), value: s.host },
    { label: i18n.global.t('devices.guides.common.portLabel'), value: String(s.port) },
    { label: securityName, value: clientSecurityLabel(s.security) },
    { label: i18n.global.t('devices.guides.common.usernameLabel'), value: username },
  ]
}

/** Application Gmail (Android ou iPhone), compte « Personnel (IMAP) ». */
export function gmailAppSteps(s: ReadyDeviceSettings): GuideStep[] {
  const { t } = i18n.global
  return [
    { text: t('devices.guides.gmailApp.step1') },
    { text: t('devices.guides.gmailApp.step2') },
    { text: t('devices.guides.gmailApp.step3'), values: [{ label: t('devices.guides.common.addressLabel'), value: s.email }] },
    { text: t('devices.guides.gmailApp.step4') },
    { text: t('devices.guides.gmailApp.step5') },
    { text: t('devices.guides.gmailApp.step6'), values: serverValues(s.imap, s.username, t('devices.guides.gmailApp.securityTypeLabel')) },
    { text: t('devices.guides.gmailApp.step7'), values: serverValues(s.smtp, s.username, t('devices.guides.gmailApp.securityTypeLabel')) },
    { text: t('devices.guides.gmailApp.step8') },
  ]
}

/** Gmail sur ordinateur : « Envoyer des e-mails en tant que » avec le serveur d'envoi de l'établissement. */
export function gmailSendAsSteps(s: ReadyDeviceSettings): GuideStep[] {
  const { t } = i18n.global
  const tls = s.smtp.security === 'ssl' ? t('devices.guides.gmailSendAs.tlsSsl') : t('devices.guides.gmailSendAs.tlsStarttls')
  return [
    { text: t('devices.guides.gmailSendAs.step1') },
    { text: t('devices.guides.gmailSendAs.step2'), values: [{ label: t('devices.guides.common.addressLabel'), value: s.email }] },
    {
      text: t('devices.guides.gmailSendAs.step3', { tls }),
      values: [
        { label: t('devices.guides.gmailSendAs.smtpServerLabel'), value: s.smtp.host },
        { label: t('devices.guides.common.portLabel'), value: String(s.smtp.port) },
        { label: t('devices.guides.gmailSendAs.usernameFullLabel'), value: s.username },
      ],
    },
    { text: t('devices.guides.gmailSendAs.step4', { product: s.productName }) },
  ]
}

/** iPhone / iPad : installation du profil de configuration téléchargé. */
export function appleProfileSteps(s: ReadyDeviceSettings): GuideStep[] {
  const { t } = i18n.global
  return [
    { text: t('devices.guides.appleProfile.step1') },
    { text: t('devices.guides.appleProfile.step2') },
    { text: t('devices.guides.appleProfile.step3', { product: s.productName }) },
    { text: t('devices.guides.appleProfile.step4') },
    { text: t('devices.guides.appleProfile.step5') },
  ]
}

/** iPhone / iPad : ajout manuel du compte. */
export function appleManualSteps(s: ReadyDeviceSettings): GuideStep[] {
  const { t } = i18n.global
  return [
    { text: t('devices.guides.appleManual.step1') },
    { text: t('devices.guides.appleManual.step2') },
    { text: t('devices.guides.appleManual.step3'), values: [{ label: t('devices.guides.common.addressLabel'), value: s.email }] },
    { text: t('devices.guides.appleManual.step4'), values: [{ label: t('devices.guides.appleManual.hostnameLabel'), value: s.imap.host }, { label: t('devices.guides.common.usernameLabel'), value: s.username }] },
    { text: t('devices.guides.appleManual.step5'), values: [{ label: t('devices.guides.appleManual.hostnameLabel'), value: s.smtp.host }, { label: t('devices.guides.common.usernameLabel'), value: s.username }] },
    {
      text: t('devices.guides.appleManual.step6'),
      values: [{ label: t('devices.guides.appleManual.incomingPortLabel'), value: String(s.imap.port) }, { label: t('devices.guides.appleManual.outgoingPortLabel'), value: String(s.smtp.port) }],
    },
  ]
}

export function outlookSteps(s: ReadyDeviceSettings): GuideStep[] {
  const { t } = i18n.global
  return [
    { text: t('devices.guides.outlook.step1') },
    { text: t('devices.guides.outlook.step2'), values: [{ label: t('devices.guides.common.addressLabel'), value: s.email }] },
    { text: t('devices.guides.outlook.step3') },
    { text: t('devices.guides.outlook.step4'), values: serverValues(s.imap, s.username, t('devices.guides.outlook.encryptionMethodLabel')) },
    { text: t('devices.guides.outlook.step5'), values: serverValues(s.smtp, s.username, t('devices.guides.outlook.encryptionMethodLabel')) },
    { text: t('devices.guides.outlook.step6') },
  ]
}

export function thunderbirdSteps(s: ReadyDeviceSettings): GuideStep[] {
  const { t } = i18n.global
  return [
    { text: t('devices.guides.thunderbird.step1') },
    { text: t('devices.guides.thunderbird.step2'), values: [{ label: t('devices.guides.common.addressLabel'), value: s.email }] },
    { text: t('devices.guides.thunderbird.step3') },
    { text: t('devices.guides.thunderbird.step4'), values: serverValues(s.imap, s.username, t('devices.guides.thunderbird.sslLabel')) },
    { text: t('devices.guides.thunderbird.step5'), values: serverValues(s.smtp, s.username, t('devices.guides.thunderbird.sslLabel')) },
  ]
}

export function otherAppSteps(): GuideStep[] {
  const { t } = i18n.global
  return [
    { text: t('devices.guides.other.step1') },
    { text: t('devices.guides.other.step2') },
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
  const { t } = i18n.global
  const domain = forwardDomains[0] ?? t('devices.guides.forwardPlaceholderDomain')
  return `${t('devices.guides.forwardPlaceholderName')}@${domain}`
}

/** Application proposée d'abord selon l'appareil utilisé. */
export function defaultDeviceApp(userAgent: string, maxTouchPoints = 0): DeviceApp {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'apple'
  return 'gmail'
}
