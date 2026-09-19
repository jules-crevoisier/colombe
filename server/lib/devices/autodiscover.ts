/**
 * Autodiscover « POX » (Plain Old XML) d'Outlook pour un compte IMAP/SMTP.
 *
 * Outlook envoie en POST un document contenant <EMailAddress>. On n'en retient
 * l'adresse que si elle est syntaxiquement valide et appartient à un domaine de
 * l'établissement ; sinon la réponse ne contient pas de LoginName (Outlook le
 * demandera). Aucune autre donnée de la requête n'est renvoyée.
 */
import { domainOf, escapeXml } from './xml'
import type { PublicServer } from './xml'

/** Taille maximale lue dans le corps de la requête. */
export const AUTODISCOVER_MAX_BODY = 8 * 1024

const REQUEST_EMAIL_RE = /<(?:[A-Za-z][\w.-]*:)?EMailAddress>\s*([^<>\s]{3,254})\s*<\/(?:[A-Za-z][\w.-]*:)?EMailAddress>/
const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/**
 * Adresse demandée par Outlook, en minuscules, ou null si absente, invalide ou
 * hors des domaines de l'établissement.
 */
export function extractAutodiscoverEmail(body: string, domains: readonly string[]): string | null {
  if (!body || body.length > AUTODISCOVER_MAX_BODY) return null
  const match = REQUEST_EMAIL_RE.exec(body)
  if (!match) return null
  const email = match[1]!.toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) return null
  const localPart = email.slice(0, email.lastIndexOf('@'))
  if (localPart.length > 64) return null
  return domains.includes(domainOf(email)) ? email : null
}

export interface AutodiscoverInput {
  imap: PublicServer
  smtp: PublicServer
  /** Identifiant à présenter, ou null pour le laisser saisir. */
  loginName: string | null
}

function protocol(type: 'IMAP' | 'SMTP', s: PublicServer, loginName: string | null): string {
  const lines = [
    '      <Protocol>',
    `        <Type>${type}</Type>`,
    `        <Server>${escapeXml(s.host)}</Server>`,
    `        <Port>${Math.trunc(s.port)}</Port>`,
    '        <DomainRequired>off</DomainRequired>',
  ]
  if (loginName) lines.push(`        <LoginName>${escapeXml(loginName)}</LoginName>`)
  lines.push('        <SPA>off</SPA>')
  // STARTTLS : <Encryption>TLS</Encryption> (prioritaire sur <SSL> pour Outlook).
  if (s.security === 'ssl') lines.push('        <SSL>on</SSL>')
  else lines.push('        <SSL>off</SSL>', '        <Encryption>TLS</Encryption>')
  lines.push('        <AuthRequired>on</AuthRequired>')
  if (type === 'SMTP') lines.push('        <UsePOPAuth>on</UsePOPAuth>', '        <SMTPLast>off</SMTPLast>')
  lines.push('      </Protocol>')
  return lines.join('\n')
}

/** Réponse XML (schéma 2006 / outlook 2006a). */
export function buildAutodiscover(input: AutodiscoverInput): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">',
    '  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">',
    '    <Account>',
    '      <AccountType>email</AccountType>',
    '      <Action>settings</Action>',
    protocol('IMAP', input.imap, input.loginName),
    protocol('SMTP', input.smtp, input.loginName),
    '    </Account>',
    '  </Response>',
    '</Autodiscover>',
    '',
  ].join('\n')
}
