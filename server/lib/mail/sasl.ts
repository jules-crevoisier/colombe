/**
 * Chaînes SASL et options d'authentification IMAP/SMTP pour chaque type de session
 * (voir `MailAuth` dans backend.ts). Fonctions pures, testées octet par octet
 * (tests/unit/mail/sasl.test.ts) : aucune cryptographie ici, seulement du cadrage.
 *
 *   - XOAUTH2      : format Google, https://developers.google.com/gmail/imap/xoauth2-protocol
 *   - OAUTHBEARER  : RFC 7628 (section 3.1), en-tête GS2 « n,a=<user>, »
 *   - PLAIN        : RFC 4616, « authzid NUL authcid NUL mot de passe »
 */
import type { SMTPConnectionCustomAuthContext, SMTPConnectionCustomAuthHandlers, SMTPConnectionCustomAuthResponse } from 'nodemailer/lib/smtp-connection'
import type { SMTPTransportAuthOptions } from 'nodemailer/lib/smtp-transport'
import { masterLogin } from '../config'
import type { MailCredentials, MailServerConfig } from './backend'
import { mailUsername } from './backend'

/** Séparateur de champs XOAUTH2/OAUTHBEARER (octet 0x01). */
const KVSEP = '\x01'

/** Charge utile XOAUTH2 (avant base64) : `user=<u>^Aauth=Bearer <t>^A^A`. */
export function xoauth2Payload(user: string, accessToken: string): string {
  return `user=${user}${KVSEP}auth=Bearer ${accessToken}${KVSEP}${KVSEP}`
}

/** Réponse initiale XOAUTH2, en base64 (argument de `AUTHENTICATE XOAUTH2`). */
export function xoauth2Token(user: string, accessToken: string): string {
  return Buffer.from(xoauth2Payload(user, accessToken), 'utf-8').toString('base64')
}

/** `saslname` de RFC 5801 : « = » devient « =3D », « , » devient « =2C ». */
export function gs2SaslName(user: string): string {
  return user.replace(/=/g, '=3D').replace(/,/g, '=2C')
}

/**
 * Charge utile OAUTHBEARER (RFC 7628 §3.1) :
 * `n,a=<user>,^Ahost=<hôte>^Aport=<port>^Aauth=Bearer <t>^A^A`.
 */
export function oauthbearerPayload(user: string, accessToken: string, host: string, port: number): string {
  return `n,a=${gs2SaslName(user)},${KVSEP}host=${host}${KVSEP}port=${port}${KVSEP}auth=Bearer ${accessToken}${KVSEP}${KVSEP}`
}

export function oauthbearerToken(user: string, accessToken: string, host: string, port: number): string {
  return Buffer.from(oauthbearerPayload(user, accessToken, host, port), 'utf-8').toString('base64')
}

/** Réponse RFC 7628 §3.2.3 à un défi d'erreur OAUTHBEARER : un seul octet 0x01. */
export const OAUTHBEARER_ABORT = Buffer.from(KVSEP, 'utf-8').toString('base64')

/** Réponse initiale PLAIN (RFC 4616), base64. `authzid` vide : s'authentifier pour soi-même. */
export function plainToken(authzid: string, authcid: string, password: string): string {
  return Buffer.from(`${authzid}\x00${authcid}\x00${password}`, 'utf-8').toString('base64')
}

// ─── Options par protocole ───

/** Options `auth` d'ImapFlow. */
export type ImapAuthOptions = { user: string; pass: string } | { user: string; accessToken: string }

/** Erreur de configuration : session OIDC sans MAIL_SSO_AUTH correspondant (ne devrait jamais arriver). */
function missingSso(kind: string): Error {
  return new Error(`Session ${kind} sans configuration MAIL_SSO_AUTH correspondante`)
}

/**
 * Authentification IMAP. Pour oauth2, imapflow choisit lui-même OAUTHBEARER si le serveur
 * l'annonce, sinon XOAUTH2 (Dovecot valide les deux de la même façon).
 */
export function imapAuth(creds: MailCredentials, config: Pick<MailServerConfig, 'loginUsername' | 'mailSso'>): ImapAuthOptions {
  const user = mailUsername(creds.email, config)
  const auth = creds.auth
  if (auth.kind === 'password') return { user, pass: auth.password }
  if (auth.kind === 'oauth2') return { user, accessToken: auth.accessToken }
  const sso = config.mailSso
  if (sso?.mode !== 'master') throw missingSso('master')
  return { user: masterLogin(user, sso.masterUser, sso.separator), pass: sso.masterPassword }
}

/** Options d'authentification nodemailer (fusionnées dans createTransport). */
export interface SmtpAuthOptions {
  auth: SMTPTransportAuthOptions
  customAuth?: SMTPConnectionCustomAuthHandlers
}

/** `sendCommand` sans callback renvoie toujours une promesse (voir smtp-connection). */
async function send(ctx: SMTPConnectionCustomAuthContext, cmd: string): Promise<SMTPConnectionCustomAuthResponse> {
  const res = await ctx.sendCommand(cmd)
  if (!res) throw smtpFailure('pas de réponse')
  return res
}

function smtpFailure(response: string): Error {
  const err = new Error(`Authentification SMTP refusée : ${response}`) as Error & { code: string }
  err.code = 'EAUTH'
  return err
}

/**
 * Échange SASL SMTP en deux temps (RFC 4954) : `AUTH <mécanisme>`, défi 334 vide, puis la
 * réponse sur sa propre ligne. Pas de « réponse initiale » sur la ligne AUTH : un jeton
 * OIDC (JWT de 1 à 2 Ko en base64) dépasse la longueur de ligne de commande acceptée par
 * la soumission Dovecot (« 500 5.5.2 Line too long »). Un nouveau défi 334 après la réponse
 * signale une erreur OAuth (JSON) : on termine l'échange avec `abort`, le serveur répond 535.
 */
async function saslExchange(ctx: SMTPConnectionCustomAuthContext, mechanism: string, response: string, abort: string): Promise<void> {
  const start = await send(ctx, `AUTH ${mechanism}`)
  if (start.status !== 334) throw smtpFailure(start.response)
  let res = await send(ctx, response)
  if (res.status === 334) res = await send(ctx, abort)
  if (res.status !== 235) throw smtpFailure(res.response)
}

/** Clés `customAuth` : jamais le nom d'un mécanisme natif de nodemailer (XOAUTH2 y est réservé). */
export const SMTP_CUSTOM_AUTH = {
  xoauth2: 'COLOMBE-XOAUTH2',
  oauthbearer: 'COLOMBE-OAUTHBEARER',
  master: 'COLOMBE-PLAIN-MASTER',
} as const

/**
 * Authentification SMTP (soumission Postfix/Dovecot) :
 *   - password : AUTH PLAIN/LOGIN de nodemailer (inchangé) ;
 *   - oauth2 + xoauth2 : AUTH XOAUTH2 (format Google) ;
 *   - oauth2 + oauthbearer : AUTH OAUTHBEARER (RFC 7628) ;
 *   - master : AUTH PLAIN avec authzid = utilisateur, authcid = utilisateur maître.
 */
export function smtpAuth(
  creds: MailCredentials,
  config: Pick<MailServerConfig, 'loginUsername' | 'mailSso' | 'smtpHost' | 'smtpServername' | 'smtpPort'>
): SmtpAuthOptions {
  const user = mailUsername(creds.email, config)
  const auth = creds.auth
  if (auth.kind === 'password') return { auth: { user, pass: auth.password } }

  const sso = config.mailSso
  if (auth.kind === 'oauth2') {
    const mechanism = sso?.mode === 'oauth2' ? sso.mechanism : 'xoauth2'
    if (mechanism === 'xoauth2') {
      const token = xoauth2Token(user, auth.accessToken)
      return {
        auth: { type: 'custom', method: SMTP_CUSTOM_AUTH.xoauth2, user },
        // Abandon XOAUTH2 : ligne vide.
        customAuth: { [SMTP_CUSTOM_AUTH.xoauth2]: ctx => saslExchange(ctx, 'XOAUTH2', token, '') },
      }
    }
    const token = oauthbearerToken(user, auth.accessToken, config.smtpServername || config.smtpHost, config.smtpPort)
    return {
      auth: { type: 'custom', method: SMTP_CUSTOM_AUTH.oauthbearer, user },
      // Abandon OAUTHBEARER : ^A (RFC 7628 §3.2.3).
      customAuth: { [SMTP_CUSTOM_AUTH.oauthbearer]: ctx => saslExchange(ctx, 'OAUTHBEARER', token, OAUTHBEARER_ABORT) },
    }
  }

  if (sso?.mode !== 'master') throw missingSso('master')
  const token = plainToken(user, sso.masterUser, sso.masterPassword)
  return {
    auth: { type: 'custom', method: SMTP_CUSTOM_AUTH.master, user },
    customAuth: { [SMTP_CUSTOM_AUTH.master]: ctx => saslExchange(ctx, 'PLAIN', token, '*') },
  }
}
