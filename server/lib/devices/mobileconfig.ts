/**
 * Profil de configuration Apple (iPhone, iPad, Mac) : un compte IMAP pour l'app Mail.
 *
 * Le profil ne contient JAMAIS de mot de passe : iOS le demande à l'installation.
 * Il n'est pas signé (iOS affiche « Non signé ») : aucun certificat de signature
 * n'est confié à Colombe.
 *
 * Référence : Apple Platform Deployment, « Mail payload settings » (com.apple.mail.managed).
 */
import { createHash } from 'node:crypto'
import { domainOf, escapeXml } from './xml'
import type { PublicServer } from './xml'

export interface AppleProfileInput {
  email: string
  /** Identifiant présenté au serveur (adresse complète ou partie avant @). */
  username: string
  imap: PublicServer
  smtp: PublicServer
  productName: string
  /** Établissement (PayloadOrganization) ; vide = nom du produit. */
  orgName: string
}

/**
 * UUID stable pour une adresse et un rôle : réinstaller le profil remplace
 * l'ancien au lieu d'en ajouter un second. Format UUID v5 (variante RFC 4122).
 */
export function stableUuid(email: string, role: string): string {
  const bytes = createHash('sha256').update(`colombe:mobileconfig:${role}:${email.toLowerCase()}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Nom du produit réduit à [a-z0-9-] (identifiants, nom de fichier). */
function slug(value: string, fallback: string): string {
  const s = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || fallback
}

/**
 * Identifiant du profil en notation de domaine inversé, ex.
 * « fr.univ-exemple.colombe.mail.3f2a9c1b0d4e ». Stable pour une adresse donnée.
 */
export function profileIdentifier(email: string, productName: string): string {
  const reversed = domainOf(email).split('.').filter(Boolean).reverse().map(part => slug(part, 'x')).join('.')
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12)
  return `${reversed || 'local'}.${slug(productName, 'colombe')}.mail.${hash}`
}

/** Nom de fichier sûr pour Content-Disposition, ex. « Colombe.mobileconfig ». */
export function profileFilename(productName: string): string {
  const base = productName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ._-]+/g, '').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '')
  return `${base || 'Colombe'}.mobileconfig`
}

const str = (key: string, value: string | number): string => `\t\t\t<key>${key}</key>\n\t\t\t<string>${escapeXml(value)}</string>`
const int = (key: string, value: number): string => `\t\t\t<key>${key}</key>\n\t\t\t<integer>${Math.trunc(value)}</integer>`
const bool = (key: string, value: boolean): string => `\t\t\t<key>${key}</key>\n\t\t\t<${value ? 'true' : 'false'}/>`
const top = (line: string): string => line.replace(/^\t\t/gm, '')

/** Profil XML (plist) prêt à servir en application/x-apple-aspen-config. */
export function buildAppleProfile(input: AppleProfileInput): string {
  const { email, username, imap, smtp, productName } = input
  const org = input.orgName.trim() || productName
  const identifier = profileIdentifier(email, productName)
  const accountDescription = `${productName} (${email})`

  // Le chiffrement est toujours exigé : TLS implicite (ssl) ou STARTTLS, les deux
  // se déclarent par UseSSL=true côté Apple (le port choisit le mode).
  const account = [
    str('EmailAccountDescription', accountDescription),
    str('EmailAccountType', 'EmailTypeIMAP'),
    str('EmailAddress', email),
    str('IncomingMailServerAuthentication', 'EmailAuthPassword'),
    str('IncomingMailServerHostName', imap.host),
    int('IncomingMailServerPortNumber', imap.port),
    bool('IncomingMailServerUseSSL', true),
    str('IncomingMailServerUsername', username),
    str('OutgoingMailServerAuthentication', 'EmailAuthPassword'),
    str('OutgoingMailServerHostName', smtp.host),
    int('OutgoingMailServerPortNumber', smtp.port),
    bool('OutgoingMailServerUseSSL', true),
    str('OutgoingMailServerUsername', username),
    bool('OutgoingPasswordSameAsIncomingPassword', true),
    str('PayloadDescription', `Compte de messagerie ${email}`),
    str('PayloadDisplayName', accountDescription),
    str('PayloadIdentifier', `${identifier}.account`),
    str('PayloadType', 'com.apple.mail.managed'),
    str('PayloadUUID', stableUuid(email, 'account')),
    int('PayloadVersion', 1),
    bool('PreventAppSheet', false),
    bool('PreventMove', false),
    bool('SMIMEEnabled', false),
  ].join('\n')

  const profile = [
    str('PayloadDescription', `Ajoute votre compte ${email} à l'app Mail. Votre mot de passe vous sera demandé pendant l'installation ; il n'est pas contenu dans ce profil.`),
    str('PayloadDisplayName', `${productName} : ${email}`),
    str('PayloadIdentifier', identifier),
    str('PayloadOrganization', org),
    bool('PayloadRemovalDisallowed', false),
    str('PayloadType', 'Configuration'),
    str('PayloadUUID', stableUuid(email, 'profile')),
    int('PayloadVersion', 1),
  ].map(top).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>PayloadContent</key>',
    '\t<array>',
    '\t\t<dict>',
    account,
    '\t\t</dict>',
    '\t</array>',
    profile,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}
