/**
 * Sondes réseau pour colombe-setup / colombe-doctor : connexion TCP+TLS vers IMAP, SMTP
 * et ManageSieve, avec lecture des bannières/capacités et vérification de certificat.
 * Aussi : authentification réelle (IMAP LOGIN, SMTP AUTH) pour `colombe-doctor --user`.
 *
 * Zéro dépendance npm : uniquement node:net, node:tls, node:crypto (base64).
 */
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

const DEFAULT_TIMEOUT = 5000

function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function connectPlain(host, port, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const socket = netConnect({ host, port })
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    }),
    timeoutMs,
    `Connexion TCP à ${host}:${port} : délai dépassé (${timeoutMs} ms).`
  )
}

function upgradeToTls(socket, servername, rejectUnauthorized, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const tlsSocket = tlsConnect({ socket, servername, rejectUnauthorized })
      tlsSocket.once('secureConnect', () => resolve(tlsSocket))
      tlsSocket.once('error', reject)
    }),
    timeoutMs,
    `Négociation TLS avec ${servername} : délai dépassé (${timeoutMs} ms).`
  )
}

function connectTls(host, port, servername, rejectUnauthorized, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const socket = tlsConnect({ host, port, servername, rejectUnauthorized })
      socket.once('secureConnect', () => resolve(socket))
      socket.once('error', reject)
    }),
    timeoutMs,
    `Connexion TLS à ${host}:${port} : délai dépassé (${timeoutMs} ms).`
  )
}

/** Lit des lignes texte sur un socket jusqu'à ce que `isDone(line)` renvoie true. */
function readLines(socket, isDone, timeoutMs, maxLines = 500) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = ''
      const lines = []
      const onData = (chunk) => {
        buffer += chunk.toString('utf8')
        let idx
        // eslint-disable-next-line no-cond-assign
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).replace(/\r$/, '')
          buffer = buffer.slice(idx + 1)
          lines.push(line)
          if (lines.length > maxLines) return reject(new Error('Trop de lignes reçues, arrêt.'))
          if (isDone(line)) {
            cleanup()
            return resolve({ lines, last: line })
          }
        }
      }
      const onError = (err) => { cleanup(); reject(err) }
      const onClose = () => { cleanup(); reject(new Error('Connexion fermée par le serveur avant la réponse attendue.')) }
      function cleanup() {
        socket.off('data', onData)
        socket.off('error', onError)
        socket.off('close', onClose)
      }
      socket.on('data', onData)
      socket.once('error', onError)
      socket.once('close', onClose)
    }),
    timeoutMs,
    'Délai dépassé en attente de réponse du serveur.'
  )
}

function writeLine(socket, line) {
  return new Promise((resolve, reject) => socket.write(`${line}\r\n`, err => (err ? reject(err) : resolve())))
}

function write(socket, data) {
  return new Promise((resolve, reject) => socket.write(data, err => (err ? reject(err) : resolve())))
}

function safeEnd(socket) {
  try { socket.end() }
  catch { /* déjà fermé */ }
}

// ---------------------------------------------------------------------------
// Certificats
// ---------------------------------------------------------------------------

/** `DNS:foo.example.org, DNS:*.example.org` (format Node) → tableau de noms. */
function parseSubjectAltNames(cert) {
  if (!cert?.subjectaltname) return []
  return cert.subjectaltname
    .split(',')
    .map(s => s.trim())
    .filter(s => s.toUpperCase().startsWith('DNS:'))
    .map(s => s.slice(4))
}

function hostMatchesPattern(hostname, pattern) {
  const h = hostname.toLowerCase()
  const p = pattern.toLowerCase()
  if (h === p) return true
  if (p.startsWith('*.')) {
    const suffix = p.slice(1) // ".example.org"
    return h.endsWith(suffix) && h.slice(0, -suffix.length).length > 0 && !h.slice(0, -suffix.length).includes('.')
  }
  return false
}

/** Résumé exploitable d'un certificat TLS (sujet, SAN, expiration, correspondance au nom attendu). */
export function summarizeCertificate(tlsSocket, expectedHostname) {
  const cert = tlsSocket.getPeerCertificate(false)
  if (!cert || !Object.keys(cert).length) return null
  const sans = parseSubjectAltNames(cert)
  const names = sans.length ? sans : (cert.subject?.CN ? [cert.subject.CN] : [])
  const matches = names.some(n => hostMatchesPattern(expectedHostname, n))
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null
  const daysRemaining = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null
  return {
    subjectCN: cert.subject?.CN ?? null,
    issuerCN: cert.issuer?.CN ?? null,
    altNames: sans,
    validTo: cert.valid_to ?? null,
    daysRemaining,
    matchesHostname: matches,
    authorized: tlsSocket.authorized === true,
    authorizationError: tlsSocket.authorizationError ?? null,
  }
}

// ---------------------------------------------------------------------------
// IMAP
// ---------------------------------------------------------------------------

/**
 * Sonde IMAP : connexion (TLS implicite ou en clair), STARTTLS si demandé, lecture de la
 * bannière et des capacités. `{ ok, secure, capabilities, cert, error }`.
 */
export async function probeImap({ host, port, secure, servername, rejectUnauthorized = true, timeoutMs = DEFAULT_TIMEOUT }) {
  let socket
  try {
    if (secure) {
      socket = await connectTls(host, port, servername || host, rejectUnauthorized, timeoutMs)
    }
    else {
      socket = await connectPlain(host, port, timeoutMs)
    }

    const greeting = await readLines(socket, line => /^\*\s/.test(line), timeoutMs)
    if (!/^\*\s+OK/i.test(greeting.last)) {
      safeEnd(socket)
      return { ok: false, secure, error: `Bannière IMAP inattendue : ${greeting.last}` }
    }

    let tlsSocket = secure ? socket : null
    if (!secure) {
      await writeLine(socket, 'a1 STARTTLS')
      const res = await readLines(socket, line => /^a1\s/i.test(line), timeoutMs)
      if (!/^a1\s+OK/i.test(res.last)) {
        safeEnd(socket)
        return { ok: false, secure: false, error: `STARTTLS refusé : ${res.last}` }
      }
      tlsSocket = await upgradeToTls(socket, servername || host, rejectUnauthorized, timeoutMs)
    }

    await writeLine(tlsSocket, 'a2 CAPABILITY')
    const capRes = await readLines(tlsSocket, line => /^a2\s/i.test(line), timeoutMs)
    if (!/^a2\s+OK/i.test(capRes.last)) {
      safeEnd(tlsSocket)
      return { ok: false, secure: true, error: `CAPABILITY refusée : ${capRes.last}` }
    }
    const capLine = capRes.lines.find(l => /^\*\s+CAPABILITY/i.test(l)) ?? ''
    const capabilities = capLine.replace(/^\*\s+CAPABILITY\s*/i, '').split(/\s+/).filter(Boolean)
    const cert = summarizeCertificate(tlsSocket, servername || host)
    safeEnd(tlsSocket)
    return { ok: true, secure: true, capabilities, cert }
  }
  catch (err) {
    if (socket) safeEnd(socket)
    return { ok: false, secure, error: err.message }
  }
}

/** LOGIN IMAP réel (littéraux `{n}`, sûr même si le mot de passe contient des guillemets). */
export async function imapLogin({ host, port, secure, servername, rejectUnauthorized = true, timeoutMs = DEFAULT_TIMEOUT }, username, password) {
  let socket
  try {
    socket = secure
      ? await connectTls(host, port, servername || host, rejectUnauthorized, timeoutMs)
      : await connectPlain(host, port, timeoutMs)

    const greeting = await readLines(socket, line => /^\*\s/.test(line), timeoutMs)
    if (!/^\*\s+OK/i.test(greeting.last)) return { ok: false, error: `Bannière IMAP inattendue : ${greeting.last}` }

    let tlsSocket = secure ? socket : null
    if (!secure) {
      await writeLine(socket, 'a1 STARTTLS')
      const res = await readLines(socket, line => /^a1\s/i.test(line), timeoutMs)
      if (!/^a1\s+OK/i.test(res.last)) return { ok: false, error: `STARTTLS refusé : ${res.last}` }
      tlsSocket = await upgradeToTls(socket, servername || host, rejectUnauthorized, timeoutMs)
    }

    const userBytes = Buffer.byteLength(username, 'utf8')
    await write(tlsSocket, `a3 LOGIN {${userBytes}}\r\n`)
    await readLines(tlsSocket, line => /^\+/.test(line), timeoutMs)
    const passBytes = Buffer.byteLength(password, 'utf8')
    await write(tlsSocket, `${username} {${passBytes}}\r\n`)
    await readLines(tlsSocket, line => /^\+/.test(line), timeoutMs)
    await write(tlsSocket, `${password}\r\n`)
    const res = await readLines(tlsSocket, line => /^a3\s/i.test(line), timeoutMs)
    safeEnd(tlsSocket)
    if (/^a3\s+OK/i.test(res.last)) return { ok: true }
    return { ok: false, error: `LOGIN IMAP refusé (identifiants invalides ?) : ${res.last}` }
  }
  catch (err) {
    if (socket) safeEnd(socket)
    return { ok: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

function parseSmtpMultiline(lines) {
  // "250-STARTTLS" / "250 AUTH PLAIN LOGIN" → tableau de mots-clés en majuscules.
  return lines.map(l => l.replace(/^\d{3}[- ]/, '').trim().toUpperCase())
}

/** Sonde SMTP : bannière, EHLO, capacités annoncées (STARTTLS, AUTH), certificat si TLS. */
export async function probeSmtp({ host, port, secure, servername, rejectUnauthorized = true, timeoutMs = DEFAULT_TIMEOUT }) {
  let socket
  try {
    socket = secure
      ? await connectTls(host, port, servername || host, rejectUnauthorized, timeoutMs)
      : await connectPlain(host, port, timeoutMs)

    const banner = await readLines(socket, line => /^220\s/.test(line), timeoutMs)
    if (!/^220/.test(banner.lines[0] ?? '')) return { ok: false, secure, error: `Bannière SMTP inattendue : ${banner.last}` }

    await writeLine(socket, 'EHLO colombe-doctor.invalid')
    const ehlo = await readLines(socket, line => /^250\s/.test(line), timeoutMs)
    let keywords = parseSmtpMultiline(ehlo.lines)
    // Capturé AVANT un éventuel upgrade TLS : un serveur ne re-propose pas STARTTLS une
    // fois la session déjà chiffrée, donc `keywords` seul (après upgrade) le perdrait.
    const startTlsAdvertised = keywords.some(k => k.startsWith('STARTTLS'))

    let tlsSocket = secure ? socket : null
    if (!secure && startTlsAdvertised) {
      await writeLine(socket, 'STARTTLS')
      const res = await readLines(socket, line => /^220\s/.test(line), timeoutMs)
      if (!/^220/.test(res.last)) return { ok: false, secure: false, error: `STARTTLS refusé : ${res.last}` }
      tlsSocket = await upgradeToTls(socket, servername || host, rejectUnauthorized, timeoutMs)
      await writeLine(tlsSocket, 'EHLO colombe-doctor.invalid')
      const ehlo2 = await readLines(tlsSocket, line => /^250\s/.test(line), timeoutMs)
      keywords = parseSmtpMultiline(ehlo2.lines)
    }

    const authLine = keywords.find(k => k.startsWith('AUTH'))
    const authMechanisms = authLine ? authLine.replace(/^AUTH\s*/, '').split(/\s+/).filter(Boolean) : []
    const cert = tlsSocket ? summarizeCertificate(tlsSocket, servername || host) : null
    if (tlsSocket) await writeLine(tlsSocket, 'QUIT').catch(() => {})
    safeEnd(tlsSocket || socket)
    return {
      ok: true,
      secure: !!tlsSocket,
      startTlsAdvertised,
      authMechanisms,
      cert,
    }
  }
  catch (err) {
    if (socket) safeEnd(socket)
    return { ok: false, secure, error: err.message }
  }
}

/** AUTH PLAIN (repli LOGIN) réel, après EHLO + STARTTLS si nécessaire. */
export async function smtpAuth({ host, port, secure, servername, rejectUnauthorized = true, timeoutMs = DEFAULT_TIMEOUT }, username, password) {
  let socket
  try {
    socket = secure
      ? await connectTls(host, port, servername || host, rejectUnauthorized, timeoutMs)
      : await connectPlain(host, port, timeoutMs)

    // Bannière SMTP, potentiellement multiligne ("220-..." puis "220 ..." en dernière ligne).
    const banner = await readLines(socket, line => /^220\s/.test(line), timeoutMs)
    if (!/^220/.test(banner.lines[0] ?? '')) return { ok: false, error: `Bannière SMTP inattendue : ${banner.last}` }

    await writeLine(socket, 'EHLO colombe-doctor.invalid')
    const ehlo = await readLines(socket, line => /^250\s/.test(line), timeoutMs)
    let keywords = parseSmtpMultiline(ehlo.lines)

    let active = socket
    if (!secure) {
      if (!keywords.some(k => k.startsWith('STARTTLS'))) return { ok: false, error: 'Le serveur SMTP ne propose pas STARTTLS : authentification refusée en clair.' }
      await writeLine(socket, 'STARTTLS')
      const res = await readLines(socket, line => /^220\s/.test(line), timeoutMs)
      if (!/^220/.test(res.last)) return { ok: false, error: `STARTTLS refusé : ${res.last}` }
      active = await upgradeToTls(socket, servername || host, rejectUnauthorized, timeoutMs)
      await writeLine(active, 'EHLO colombe-doctor.invalid')
      const ehlo2 = await readLines(active, line => /^250\s/.test(line), timeoutMs)
      keywords = parseSmtpMultiline(ehlo2.lines)
    }

    const authLine = keywords.find(k => k.startsWith('AUTH')) ?? ''
    const mechanisms = authLine.replace(/^AUTH\s*/, '').split(/\s+/).filter(Boolean)

    if (mechanisms.includes('PLAIN')) {
      const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64')
      await writeLine(active, `AUTH PLAIN ${token}`)
      const res = await readLines(active, line => /^\d{3}\s/.test(line), timeoutMs)
      safeEnd(active)
      if (/^235\s/.test(res.last)) return { ok: true }
      return { ok: false, error: `AUTH PLAIN refusée : ${res.last}` }
    }

    if (mechanisms.includes('LOGIN')) {
      await writeLine(active, 'AUTH LOGIN')
      await readLines(active, line => /^334\s/.test(line), timeoutMs)
      await writeLine(active, Buffer.from(username, 'utf8').toString('base64'))
      await readLines(active, line => /^334\s/.test(line), timeoutMs)
      await writeLine(active, Buffer.from(password, 'utf8').toString('base64'))
      const res = await readLines(active, line => /^\d{3}\s/.test(line), timeoutMs)
      safeEnd(active)
      if (/^235\s/.test(res.last)) return { ok: true }
      return { ok: false, error: `AUTH LOGIN refusée : ${res.last}` }
    }

    safeEnd(active)
    return { ok: false, error: `Aucun mécanisme AUTH compatible proposé (annoncés : ${mechanisms.join(', ') || 'aucun'}).` }
  }
  catch (err) {
    if (socket) safeEnd(socket)
    return { ok: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// ManageSieve (RFC 5804)
// ---------------------------------------------------------------------------

/** Sonde ManageSieve : bannière multiligne de capacités jusqu'à la ligne `OK ...`. */
export async function probeSieve({ host, port, servername, rejectUnauthorized = true, timeoutMs = DEFAULT_TIMEOUT }) {
  let socket
  try {
    socket = await connectPlain(host, port, timeoutMs)
    const greeting = await readLines(socket, line => /^OK\b/i.test(line), timeoutMs)
    const capabilities = {}
    for (const line of greeting.lines) {
      const m = /^"([A-Z]+)"(?:\s+"([^"]*)")?/i.exec(line)
      if (m) capabilities[m[1].toUpperCase()] = m[2] ?? true
    }

    let tlsSocket = null
    if (capabilities.STARTTLS) {
      await writeLine(socket, 'STARTTLS')
      const res = await readLines(socket, line => /^OK\b/i.test(line), timeoutMs)
      if (/^OK\b/i.test(res.last)) {
        tlsSocket = await upgradeToTls(socket, servername || host, rejectUnauthorized, timeoutMs)
      }
    }
    const cert = tlsSocket ? summarizeCertificate(tlsSocket, servername || host) : null
    safeEnd(tlsSocket || socket)
    return { ok: true, secure: !!tlsSocket, capabilities, cert }
  }
  catch (err) {
    if (socket) safeEnd(socket)
    return { ok: false, error: err.message }
  }
}
