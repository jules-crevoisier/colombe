/**
 * Détection automatique des paramètres par Thunderbird (et d'autres logiciels qui
 * lisent le même format : K-9 Mail / Thunderbird Android, Evolution…).
 *
 * Format « clientConfig 1.1 » servi sur /mail/config-v1.1.xml et
 * /.well-known/autoconfig/mail/config-v1.1.xml. Public : ne contient que les
 * paramètres des serveurs, aucune donnée d'utilisateur.
 */
import type { ClientServerSettings } from '#shared/types/config'
import { escapeXml } from './xml'
import type { PublicServer } from './xml'

export interface AutoconfigInput {
  /** Domaines des adresses de l'établissement (le premier sert d'identifiant). */
  domains: string[]
  imap: PublicServer
  smtp: PublicServer
  username: ClientServerSettings['username']
  productName: string
  orgName: string
}

function server(tag: 'incomingServer' | 'outgoingServer', type: 'imap' | 'smtp', s: PublicServer, username: string): string {
  return [
    `    <${tag} type="${type}">`,
    `      <hostname>${escapeXml(s.host)}</hostname>`,
    `      <port>${Math.trunc(s.port)}</port>`,
    `      <socketType>${s.security === 'ssl' ? 'SSL' : 'STARTTLS'}</socketType>`,
    `      <authentication>password-cleartext</authentication>`,
    `      <username>${username}</username>`,
    `    </${tag}>`,
  ].join('\n')
}

/** Document XML, ou null si aucun domaine n'est configuré. */
export function buildAutoconfig(input: AutoconfigInput): string | null {
  const domains = input.domains.map(d => d.trim().toLowerCase()).filter(Boolean)
  if (!domains.length) return null
  // Jetons remplacés par le logiciel lui-même (jamais par le serveur).
  const username = input.username === 'localpart' ? '%EMAILLOCALPART%' : '%EMAILADDRESS%'
  const displayName = input.orgName.trim() ? `${input.productName} (${input.orgName.trim()})` : input.productName

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<clientConfig version="1.1">',
    `  <emailProvider id="${escapeXml(domains[0]!)}">`,
    ...domains.map(d => `    <domain>${escapeXml(d)}</domain>`),
    `    <displayName>${escapeXml(displayName)}</displayName>`,
    `    <displayShortName>${escapeXml(input.productName)}</displayShortName>`,
    server('incomingServer', 'imap', input.imap, username),
    server('outgoingServer', 'smtp', input.smtp, username),
    '  </emailProvider>',
    '</clientConfig>',
    '',
  ].join('\n')
}
