/**
 * Client ManageSieve (RFC 5804) maison, sur node:net/tls. Aucune dépendance
 * externe : même esprit que le TOTP (server/lib/auth/totp.ts).
 *
 * Le mot de passe IMAP est réutilisé tel quel comme mot de passe ManageSieve
 * (même compte, même annuaire côté Dovecot) ; il ne transite jamais par le
 * navigateur (voir server/lib/sieve/service.ts).
 */
import { connect as netConnect, Socket as NetSocket } from 'node:net'
import { connect as tlsConnectRaw, TLSSocket } from 'node:tls'
import { OAUTHBEARER_ABORT, oauthbearerToken, plainToken, xoauth2Token } from '../mail/sasl'

const COMMAND_TIMEOUT_MS = 10_000
const CONNECT_TIMEOUT_MS = 10_000

export type SieveErrorCode = 'AUTH_FAILED' | 'INVALID' | 'NOT_FOUND' | 'UNAVAILABLE' | 'CONNECT_FAILED'

/** `CONNECT_FAILED` : le serveur est injoignable (connexion refusée, DNS, délai dépassé) — jamais un 500. */
export class SieveError extends Error {
  constructor(
    public readonly code: SieveErrorCode,
    message: string,
    public readonly serverMessage?: string
  ) {
    super(message)
    this.name = 'SieveError'
  }
}

export interface SieveConfig {
  host: string
  port: number
  /** false uniquement en dev contre un certificat auto-signé (MAIL_TLS_REJECT_UNAUTHORIZED=false). */
  rejectUnauthorized: boolean
  /** Nom vérifié dans le certificat (défaut : host). Ex. ManageSieve sur 127.0.0.1 avec le certificat de mail.universite.example. */
  servername?: string
}

/**
 * Authentification ManageSieve :
 *   - plain : SASL PLAIN (mot de passe ; ou utilisateur maître Dovecot avec
 *     `authzid` = utilisateur et `user` = utilisateur maître) ;
 *   - xoauth2 / oauthbearer : jeton d'accès OIDC (session par connexion unique).
 */
export type SieveCredentials =
  | { kind: 'plain'; user: string; password: string; authzid?: string }
  | { kind: 'xoauth2' | 'oauthbearer'; user: string; accessToken: string }

// ─── Lecture des réponses : bas niveau, pur, testable avec un faux socket ───

export type SieveToken =
  | { type: 'string'; value: string }
  | { type: 'atom'; value: string }
  | { type: 'code'; value: string }

export interface SieveLine {
  tokens: SieveToken[]
}

export interface SieveResponse {
  /** Lignes non protocolaires reçues avant la ligne finale (capacités, LISTSCRIPTS, contenu de GETSCRIPT…). */
  data: SieveLine[]
  status: 'OK' | 'NO' | 'BYE'
  code: string | null
  message: string | null
}

/**
 * Lecteur incrémental des réponses ManageSieve. Reçoit des morceaux d'octets
 * arbitraires (fragmentation réseau) via `push`, et restitue les lignes
 * logiques complètes une à une via `tryReadLine` — y compris les littéraux
 * `{n+}` sur plusieurs appels à `push`. Ne dépend d'aucun socket : un test
 * peut lui pousser des `Buffer` directement.
 */
export class SieveResponseReader {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
  }

  /** Renvoie la prochaine ligne logique complète, ou `null` s'il faut plus de données. */
  tryReadLine(): SieveLine | null {
    const buf = this.buf
    let pos = 0
    const tokens: SieveToken[] = []

    while (true) {
      while (pos < buf.length && buf[pos] === 0x20) pos++
      if (pos >= buf.length) return null

      const c = buf[pos] as number

      if (c === 0x0d) {
        if (pos + 1 >= buf.length) return null
        if (buf[pos + 1] !== 0x0a) throw new SieveError('UNAVAILABLE', 'Réponse ManageSieve malformée (fin de ligne)')
        this.buf = buf.subarray(pos + 2)
        return { tokens }
      }

      if (c === 0x22) {
        // "chaîne"
        const bytes: number[] = []
        let i = pos + 1
        let closed = false
        while (i < buf.length) {
          const ch = buf[i] as number
          if (ch === 0x5c) {
            if (i + 1 >= buf.length) return null
            bytes.push(buf[i + 1] as number)
            i += 2
            continue
          }
          if (ch === 0x22) { i++; closed = true; break }
          bytes.push(ch)
          i++
        }
        if (!closed) return null
        tokens.push({ type: 'string', value: Buffer.from(bytes).toString('utf-8') })
        pos = i
        continue
      }

      if (c === 0x7b) {
        // littéral {N} ou {N+}
        let i = pos + 1
        let numStr = ''
        while (i < buf.length && (buf[i] as number) >= 0x30 && (buf[i] as number) <= 0x39) {
          numStr += String.fromCharCode(buf[i] as number)
          i++
        }
        if (i < buf.length && buf[i] === 0x2b) i++
        if (i >= buf.length) return null
        if (buf[i] !== 0x7d) throw new SieveError('UNAVAILABLE', 'Littéral ManageSieve malformé')
        i++
        if (i + 1 >= buf.length) return null
        if (buf[i] !== 0x0d || buf[i + 1] !== 0x0a) throw new SieveError('UNAVAILABLE', 'Littéral ManageSieve malformé')
        i += 2
        const n = Number(numStr)
        if (!Number.isFinite(n) || n < 0) throw new SieveError('UNAVAILABLE', 'Taille de littéral invalide')
        if (i + n > buf.length) return null
        const raw = buf.subarray(i, i + n)
        tokens.push({ type: 'string', value: raw.toString('utf-8') })
        pos = i + n
        continue
      }

      if (c === 0x28) {
        // (code de réponse)
        let depth = 1
        let i = pos + 1
        let out = ''
        while (i < buf.length && depth > 0) {
          const ch = buf[i] as number
          if (ch === 0x28) depth++
          else if (ch === 0x29) { depth--; if (depth === 0) { i++; break } }
          if (depth > 0) out += String.fromCharCode(ch)
          i++
        }
        if (depth !== 0) return null
        tokens.push({ type: 'code', value: out.trim() })
        pos = i
        continue
      }

      // atome (OK, NO, BYE, ACTIVE, nombres…)
      let i = pos
      let out = ''
      while (i < buf.length && buf[i] !== 0x20 && buf[i] !== 0x0d) {
        out += String.fromCharCode(buf[i] as number)
        i++
      }
      if (i >= buf.length) return null
      tokens.push({ type: 'atom', value: out })
      pos = i
    }
  }
}

export function isFinalLine(line: SieveLine): boolean {
  const first = line.tokens[0]
  return first?.type === 'atom' && /^(OK|NO|BYE)$/i.test(first.value)
}

function toFinal(line: SieveLine): { status: 'OK' | 'NO' | 'BYE'; code: string | null; message: string | null } {
  const first = line.tokens[0] as { type: 'atom'; value: string }
  const status = first.value.toUpperCase() as 'OK' | 'NO' | 'BYE'
  let code: string | null = null
  let message: string | null = null
  for (const tok of line.tokens.slice(1)) {
    if (tok.type === 'code') code = tok.value
    else if (tok.type === 'string') message = tok.value
  }
  return { status, code, message }
}

// ─── Encodage des commandes envoyées ───

/** Chaîne quotée si possible (pas de CR/LF/NUL), littéral non-synchronisant sinon. */
export function encodeArg(value: string): Buffer {
  if (/[\r\n\0]/.test(value)) {
    const bytes = Buffer.from(value, 'utf-8')
    return Buffer.concat([Buffer.from(`{${bytes.length}+}\r\n`, 'ascii'), bytes])
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return Buffer.from(`"${escaped}"`, 'utf-8')
}

export function buildCommand(name: string, args: string[] = []): Buffer {
  const parts: Buffer[] = [Buffer.from(name, 'ascii')]
  for (const a of args) {
    parts.push(Buffer.from(' ', 'ascii'))
    parts.push(encodeArg(a))
  }
  parts.push(Buffer.from('\r\n', 'ascii'))
  return Buffer.concat(parts)
}

/** Toujours en littéral, même sans CR/LF : notre Dovecot cible plante sur PUTSCRIPT/CHECKSCRIPT
 * envoyés en chaîne quotée (assertion dans sa vérification de quota) — voir le rapport du live-check. */
export function encodeLiteral(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf-8')
  return Buffer.concat([Buffer.from(`{${bytes.length}+}\r\n`, 'ascii'), bytes])
}

/** Comme `buildCommand`, mais le dernier argument (le script) est forcé en littéral. */
export function buildCommandWithLiteralScript(name: string, leadingArgs: string[], script: string): Buffer {
  const parts: Buffer[] = [Buffer.from(name, 'ascii')]
  for (const a of leadingArgs) {
    parts.push(Buffer.from(' ', 'ascii'))
    parts.push(encodeArg(a))
  }
  parts.push(Buffer.from(' ', 'ascii'))
  parts.push(encodeLiteral(script))
  parts.push(Buffer.from('\r\n', 'ascii'))
  return Buffer.concat(parts)
}

// ─── Socket minimal dont dépend le client (réel en prod, injectable en test) ───

export interface SieveDuplex {
  write(data: Buffer): boolean
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  removeAllListeners(event?: string): unknown
  end(): void
  destroy(err?: Error): void
}

type LineWaiter = (line: SieveLine | null) => void

export class SieveClient {
  private socket: SieveDuplex
  private netSocket: NetSocket | TLSSocket | null
  private reader = new SieveResponseReader()
  private lineQueue: SieveLine[] = []
  private waiters: LineWaiter[] = []
  private closed = false
  private capabilitiesMap = new Map<string, string>()

  private constructor(
    private readonly config: SieveConfig,
    socket: SieveDuplex,
    netSocket: NetSocket | TLSSocket | null
  ) {
    this.socket = socket
    this.netSocket = netSocket
    this.attach(socket)
  }

  /** Construit un client directement sur un socket (réel ou faux) — pour les tests de trame, sans poignée de main. */
  static fromSocket(config: SieveConfig, socket: SieveDuplex): SieveClient {
    return new SieveClient(config, socket, null)
  }

  static async connect(config: SieveConfig, creds: SieveCredentials): Promise<SieveClient> {
    const netSocket = await new Promise<NetSocket>((resolve, reject) => {
      const s = netConnect({ host: config.host, port: config.port })
      const timer = setTimeout(() => {
        s.destroy()
        reject(new SieveError('CONNECT_FAILED', 'Délai de connexion ManageSieve dépassé'))
      }, CONNECT_TIMEOUT_MS)
      s.once('error', (err: Error) => {
        clearTimeout(timer)
        reject(new SieveError('CONNECT_FAILED', `Connexion ManageSieve impossible : ${err.message}`))
      })
      s.once('connect', () => {
        clearTimeout(timer)
        resolve(s)
      })
    })

    const client = new SieveClient(config, netSocket, netSocket)
    try {
      const greeting = await client.readResponse()
      client.updateCapabilities(greeting.data)
      if (greeting.status !== 'OK') {
        throw new SieveError('UNAVAILABLE', 'Le serveur ManageSieve a refusé la connexion', greeting.message ?? undefined)
      }

      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host)
      if (client.hasCapability('STARTTLS')) {
        await client.starttls() // met aussi à jour les capacités (Dovecot les repousse sans qu'on les redemande)
      } else if (!loopback) {
        throw new SieveError('UNAVAILABLE', 'Connexion ManageSieve non chiffrée refusée (hôte distant sans STARTTLS)')
      }

      await client.login(creds)
      return client
    } catch (err) {
      client.destroy()
      throw err
    }
  }

  private attach(socket: SieveDuplex): void {
    socket.on('data', (chunk: Buffer) => {
      this.reader.push(chunk)
      this.drain()
    })
    socket.on('close', () => {
      this.closed = true
      this.flushWaiters()
    })
    socket.on('error', () => {
      // Ne jamais laisser une erreur socket devenir une exception non gérée du process Nitro.
      this.closed = true
      this.flushWaiters()
    })
  }

  private drain(): void {
    let line: SieveLine | null
    try {
      while ((line = this.reader.tryReadLine())) {
        const waiter = this.waiters.shift()
        if (waiter) waiter(line)
        else this.lineQueue.push(line)
      }
    } catch {
      this.closed = true
      this.flushWaiters()
    }
  }

  private flushWaiters(): void {
    const waiters = this.waiters.splice(0, this.waiters.length)
    for (const w of waiters) w(null)
  }

  private nextLine(): Promise<SieveLine> {
    const queued = this.lineQueue.shift()
    if (queued) return Promise.resolve(queued)
    if (this.closed) return Promise.reject(new SieveError('UNAVAILABLE', 'Connexion ManageSieve fermée'))
    return new Promise<SieveLine>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(cb)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new SieveError('UNAVAILABLE', 'Délai dépassé en attente du serveur ManageSieve'))
      }, COMMAND_TIMEOUT_MS)
      const cb: LineWaiter = (line) => {
        clearTimeout(timer)
        if (line) resolve(line)
        else reject(new SieveError('UNAVAILABLE', 'Connexion ManageSieve fermée'))
      }
      this.waiters.push(cb)
    })
  }

  private async readResponse(): Promise<SieveResponse> {
    const data: SieveLine[] = []
    for (;;) {
      const line = await this.nextLine()
      if (isFinalLine(line)) return { data, ...toFinal(line) }
      data.push(line)
    }
  }

  private write(buf: Buffer): void {
    if (this.closed) throw new SieveError('UNAVAILABLE', 'Connexion ManageSieve fermée')
    this.socket.write(buf)
  }

  private async exchange(buf: Buffer): Promise<SieveResponse> {
    this.write(buf)
    return this.readResponse()
  }

  async command(name: string, args: string[] = []): Promise<SieveResponse> {
    return this.exchange(buildCommand(name, args))
  }

  private updateCapabilities(lines: SieveLine[]): void {
    this.capabilitiesMap.clear()
    for (const line of lines) {
      const nameTok = line.tokens[0]
      if (!nameTok || nameTok.type !== 'string') continue
      const valueTok = line.tokens[1]
      this.capabilitiesMap.set(nameTok.value.toUpperCase(), valueTok?.type === 'string' ? valueTok.value : '')
    }
  }

  hasCapability(name: string): boolean {
    return this.capabilitiesMap.has(name.toUpperCase())
  }

  /** Liste des noms de capacités (ex. STARTTLS, SIEVE…). */
  capabilitiesList(): string[] {
    return [...this.capabilitiesMap.keys()]
  }

  /** Extensions Sieve annoncées par la capacité `SIEVE` (fileinto, vacation…). */
  sieveExtensions(): string[] {
    const v = this.capabilitiesMap.get('SIEVE')
    return v ? v.split(/\s+/).filter(Boolean) : []
  }

  /** Alias de `sieveExtensions()` pour satisfaire l'interface commune avec le mock (service.ts). */
  capabilities(): string[] {
    return this.sieveExtensions()
  }

  private async starttls(): Promise<void> {
    const resp = await this.command('STARTTLS')
    if (resp.status !== 'OK') throw new SieveError('UNAVAILABLE', 'STARTTLS refusé par le serveur ManageSieve', resp.message ?? undefined)
    if (!this.netSocket) throw new SieveError('UNAVAILABLE', 'STARTTLS indisponible sur cette connexion')

    const plain = this.netSocket
    plain.removeAllListeners('data')
    plain.removeAllListeners('error')
    plain.removeAllListeners('close')
    this.reader = new SieveResponseReader()
    this.lineQueue = []

    const tlsSocket = await new Promise<TLSSocket>((resolve, reject) => {
      const socket = tlsConnectRaw({
        socket: plain,
        host: this.config.host,
        servername: this.config.servername || this.config.host,
        rejectUnauthorized: this.config.rejectUnauthorized,
      })
      const onError = (err: Error) => {
        socket.destroy()
        reject(new SieveError('UNAVAILABLE', `Échec STARTTLS ManageSieve : ${err.message}`))
      }
      socket.once('error', onError)
      socket.once('secureConnect', () => {
        socket.removeListener('error', onError)
        resolve(socket)
      })
    })

    this.netSocket = tlsSocket
    this.socket = tlsSocket
    this.attach(tlsSocket)

    // Dovecot (notre cible de production) annonce spontanément les nouvelles
    // capacités juste après la négociation TLS, sans qu'un CAPABILITY explicite
    // soit nécessaire ; ne pas la consommer ici désynchroniserait toutes les
    // réponses suivantes d'une position.
    const postTls = await this.readResponse()
    this.updateCapabilities(postTls.data)
  }

  /**
   * AUTHENTICATE avec réponse initiale (RFC 5804 §2.1). Public pour les tests de trame
   * (`fromSocket`) ; `connect()` l'appelle après STARTTLS.
   */
  async login(creds: SieveCredentials): Promise<void> {
    if (creds.kind === 'plain') {
      await this.authenticate('PLAIN', plainToken(creds.authzid ?? '', creds.user, creds.password), '*')
      return
    }
    if (creds.kind === 'xoauth2') {
      // Échec XOAUTH2 : défi porteur d'une erreur JSON, auquel on répond par une chaîne vide.
      await this.authenticate('XOAUTH2', xoauth2Token(creds.user, creds.accessToken), '')
      return
    }
    const host = this.config.servername || this.config.host
    await this.authenticate('OAUTHBEARER', oauthbearerToken(creds.user, creds.accessToken, host, this.config.port), OAUTHBEARER_ABORT)
  }

  private async authenticate(mechanism: string, initialResponse: string, abortResponse: string): Promise<void> {
    this.write(buildCommand('AUTHENTICATE', [mechanism, initialResponse]))
    const first = await this.nextLine()
    let final: { status: 'OK' | 'NO' | 'BYE'; message: string | null }
    if (isFinalLine(first)) {
      final = toFinal(first)
    } else {
      // Défi du serveur (erreur OAuth en JSON base64, ou demande inattendue) : on termine
      // l'échange SASL comme le prévoit le mécanisme, le serveur répond alors NO.
      this.write(Buffer.concat([encodeArg(abortResponse), Buffer.from('\r\n', 'ascii')]))
      final = await this.readResponse()
    }
    if (final.status !== 'OK') {
      throw new SieveError('AUTH_FAILED', 'Authentification refusée par le serveur ManageSieve', final.message ?? undefined)
    }
  }

  async listScripts(): Promise<{ name: string; active: boolean }[]> {
    const resp = await this.command('LISTSCRIPTS')
    if (resp.status !== 'OK') throw new SieveError('UNAVAILABLE', resp.message ?? 'Impossible de lister les jeux de filtres', resp.message ?? undefined)
    return resp.data
      .map((line) => {
        const nameTok = line.tokens[0]
        const name = nameTok?.type === 'string' ? nameTok.value : ''
        const active = line.tokens.some((t) => t.type === 'atom' && t.value.toUpperCase() === 'ACTIVE')
        return { name, active }
      })
      .filter((e) => e.name !== '')
  }

  async getScript(name: string): Promise<string> {
    const resp = await this.command('GETSCRIPT', [name])
    if (resp.status === 'NO') throw new SieveError('NOT_FOUND', `Jeu de filtres introuvable : ${name}`, resp.message ?? undefined)
    if (resp.status !== 'OK') throw new SieveError('UNAVAILABLE', resp.message ?? 'Lecture du script impossible', resp.message ?? undefined)
    const line = resp.data[0]
    const tok = line?.tokens[0]
    return tok?.type === 'string' ? tok.value : ''
  }

  async putScript(name: string, content: string): Promise<void> {
    const resp = await this.exchange(buildCommandWithLiteralScript('PUTSCRIPT', [name], content))
    if (resp.status !== 'OK') throw new SieveError('INVALID', resp.message ?? 'Script refusé par le serveur', resp.message ?? undefined)
  }

  async checkScript(content: string): Promise<void> {
    const resp = await this.exchange(buildCommandWithLiteralScript('CHECKSCRIPT', [], content))
    if (resp.status !== 'OK') throw new SieveError('INVALID', resp.message ?? 'Script Sieve invalide', resp.message ?? undefined)
  }

  /** `name === ''` désactive tous les scripts. */
  async setActive(name: string): Promise<void> {
    const resp = await this.command('SETACTIVE', [name])
    if (resp.status !== 'OK') throw new SieveError('INVALID', resp.message ?? 'Activation refusée', resp.message ?? undefined)
  }

  async deleteScript(name: string): Promise<void> {
    const resp = await this.command('DELETESCRIPT', [name])
    if (resp.status !== 'OK') throw new SieveError('NOT_FOUND', resp.message ?? 'Suppression refusée', resp.message ?? undefined)
  }

  async renameScript(oldName: string, newName: string): Promise<void> {
    const resp = await this.command('RENAMESCRIPT', [oldName, newName])
    if (resp.status !== 'OK') throw new SieveError('INVALID', resp.message ?? 'Renommage refusé', resp.message ?? undefined)
  }

  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT')
    } catch {
      // On ferme quoi qu'il arrive.
    }
    this.destroy()
  }

  /** Alias sémantique pour les appelants génériques (service.ts). */
  async close(): Promise<void> {
    await this.logout()
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    try { this.socket.end() } catch { /* ignore */ }
    try { this.socket.destroy() } catch { /* ignore */ }
    this.flushWaiters()
  }
}
