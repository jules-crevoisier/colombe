import DOMPurify from 'isomorphic-dompurify'

/**
 * Assainissement du HTML des e-mails (règle de sécurité n°1).
 *
 * Tout passe par DOMPurify ; les transformations propres au webmail
 * (images distantes, cid:, CSS) sont faites dans des hooks DOMPurify, donc sur
 * l'arbre DOM déjà parsé — jamais par expressions régulières sur le HTML brut,
 * qui se contournent (ex. `</style x>`).
 *
 * Défense en profondeur : le résultat est ensuite rendu dans une iframe
 * sandbox sans scripts, avec sa propre CSP.
 */

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp)[;,]/i
const REMOTE_URL = /^(?:https?:)?\/\//i

const FORBID_TAGS = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist',
  'meta', 'link', 'base', 'svg', 'math', 'audio', 'video', 'source', 'track',
  'picture', 'map', 'area', 'noscript', 'template', 'dialog', 'canvas',
]

/** Sous-ensemble de l'API DOM utilisé (le tsconfig serveur n'inclut pas lib.dom). */
interface DomElement {
  nodeType: number
  tagName: string
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

interface SanitizeContext {
  inlineImages: Record<string, string>
  remoteImages: number
}

// Les hooks DOMPurify sont globaux ; sanitize() est synchrone, donc un
// contexte module suffit tant qu'il est réinitialisé à chaque appel.
let ctx: SanitizeContext = { inlineImages: {}, remoteImages: 0 }

function decodeCssEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => {
      const cp = Number.parseInt(hex, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    })
    .replace(/\\(.)/g, '$1')
}

export function cleanCss(css: string): string {
  let s = decodeCssEscapes(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  s = s.replace(/@import[^;]*;?/gi, '')
  s = s.replace(/expression\s*\(/gi, 'blocked(')
  s = s.replace(/(?:-moz-binding|behavior)\s*:/gi, 'blocked:')
  s = s.replace(/(?:-webkit-)?image-set\s*\(/gi, 'blocked(')
  s = s.replace(/url\s*\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (match, _quote: string, rawUrl: string) => {
    const url = rawUrl.trim()
    if (SAFE_DATA_IMAGE.test(url)) return match
    if (REMOTE_URL.test(url)) ctx.remoteImages++
    return 'none'
  })
  // Le contenu d'un <style> est sérialisé tel quel : aucun « < » ne doit
  // pouvoir y refermer la balise après décodage des échappements.
  return s.replace(/</g, '\\3c ')
}

function neutralizeImageSource(el: DomElement): void {
  const src = (el.getAttribute('src') ?? '').trim()
  if (!src) return

  if (/^cid:/i.test(src)) {
    const cid = src.slice(4).replace(/^<|>$/g, '')
    const dataUri = ctx.inlineImages[cid]
    if (dataUri && SAFE_DATA_IMAGE.test(dataUri)) el.setAttribute('src', dataUri)
    else el.removeAttribute('src')
    return
  }
  if (SAFE_DATA_IMAGE.test(src)) return

  el.removeAttribute('src')
  if (REMOTE_URL.test(src)) {
    ctx.remoteImages++
    // Seules les URL https pourront être rétablies sur action de l'utilisateur.
    const url = src.startsWith('//') ? `https:${src}` : src
    if (/^https:\/\//i.test(url)) el.setAttribute('data-remote-src', url)
  }
}

// L'instance DOMPurify d'isomorphic-dompurify est partagée avec sanitize-outgoing.ts :
// chaque module n'agit que pendant son propre appel à sanitize(), sinon les règles
// de l'un (ex. retirer les images non « data: ») s'appliqueraient aux mails de l'autre.
let active = false

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (!active) return
  if (data.tagName === 'style' && node.textContent) {
    node.textContent = cleanCss(node.textContent)
  }
})

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!active || node.nodeType !== 1) return
  const el = node as unknown as DomElement

  if (el.hasAttribute('srcset')) {
    const srcset = el.getAttribute('srcset') ?? ''
    ctx.remoteImages += srcset.split(',').filter(part => REMOTE_URL.test(part.trim())).length
    el.removeAttribute('srcset')
  }

  if (el.hasAttribute('background')) {
    const bg = (el.getAttribute('background') ?? '').trim()
    if (REMOTE_URL.test(bg)) ctx.remoteImages++
    if (!SAFE_DATA_IMAGE.test(bg)) el.removeAttribute('background')
  }

  if (el.tagName === 'IMG') neutralizeImageSource(el)
  else el.removeAttribute('src')

  const style = el.getAttribute('style')
  if (style !== null) el.setAttribute('style', cleanCss(style))

  if (el.tagName === 'A') {
    if (el.hasAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer nofollow')
    }
    else {
      el.removeAttribute('target')
    }
  }
})

export function sanitizeEmailHtml(
  html: string,
  inlineImages: Record<string, string>,
): { html: string; remoteImages: number } {
  ctx = { inlineImages, remoteImages: 0 }
  active = true
  let clean: string
  try {
    clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS,
      FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping', 'xlink:href'],
      ALLOW_DATA_ATTR: false,
      // Conserve un <style> placé en tête de document.
      FORCE_BODY: true,
      WHOLE_DOCUMENT: false,
      RETURN_TRUSTED_TYPE: false,
    })
  }
  finally {
    active = false
  }
  const remoteImages = ctx.remoteImages
  ctx = { inlineImages: {}, remoteImages: 0 }
  return { html: clean, remoteImages }
}
