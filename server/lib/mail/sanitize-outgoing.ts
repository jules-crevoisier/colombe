import DOMPurify from 'isomorphic-dompurify'

/**
 * Assainissement du HTML SORTANT (éditeur riche, signatures, réponses types).
 * Liste blanche stricte : uniquement ce que produit l'éditeur. Aucune image
 * distante, aucun style libre — un compte volé ne doit pas pouvoir se servir
 * du webmail pour fabriquer des e-mails de phishing élaborés.
 *
 * Images (ROADMAP R2.1b) : seules les images `data:image/(png|jpeg|gif);base64,…`
 * sont acceptées (logo/signature auto-hébergé) ; toute autre source (distante,
 * `cid:`, `data:image/svg+xml`…) fait retirer la balise `<img>` entièrement —
 * jamais une image sans source, qui resterait détectable en HTML.
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'pre', 'code', 'hr', 'span', 'div', 'img']
const ALLOWED_ATTR = ['href', 'src', 'alt', 'width']
// data: + image + (png|jpeg|gif) + base64 uniquement, comme l'exige le contrat serveur.
const SAFE_IMAGE_DATA_URI = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+=*)$/i
/** Complète le filtre par défaut de DOMPurify pour que le `src` `data:image/…` d'un `<img>` survive au filtrage des URI. */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|data:image\/(?:png|jpeg|gif);base64,)/i
/** 200 Ko décodés max par image (ROADMAP R2.1b). */
const MAX_IMAGE_BYTES = 200 * 1024
/** Nombre max d'images `data:` dans une signature d'identité (ROADMAP R2.1b). */
export const MAX_SIGNATURE_IMAGES = 3

/** Image `data:` refusée : mauvais format, trop volumineuse, ou trop nombreuses (signature). */
export class OutgoingImageError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'OutgoingImageError'
  }
}

export interface SanitizeOutgoingOptions {
  /** Nombre maximal d'images `data:` acceptées (ex. 3 pour une signature d'identité). */
  maxImages?: number
}

function decodedBase64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

interface ImgHookContext {
  maxImages: number | undefined
  count: number
  oversized: boolean
  tooMany: boolean
}

/** Sous-ensemble de l'API DOM utilisé (le tsconfig serveur n'inclut pas lib.dom). */
interface DomElement {
  tagName: string
  getAttribute(name: string): string | null
  remove(): void
}

// Les hooks DOMPurify sont globaux ; sanitizeOutgoingHtml() est synchrone, donc
// un contexte module suffit tant qu'il est réinitialisé à chaque appel.
// L'instance est partagée avec sanitize.ts (mails reçus) : ces hooks n'agissent
// que pendant sanitizeOutgoingHtml(), jamais sur un mail reçu.
let active = false
let imgCtx: ImgHookContext = { maxImages: undefined, count: 0, oversized: false, tooMany: false }

/** Largeur d'image (attribut `width`) : entier en pixels, sur <img> uniquement. */
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (!active || data.attrName !== 'width') return
  const isImg = (node as unknown as DomElement).tagName === 'IMG'
  if (!isImg || !/^\d{1,4}$/.test(data.attrValue)) data.keepAttr = false
})

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (!active || data.tagName !== 'img') return
  const el = node as unknown as DomElement
  const src = (el.getAttribute('src') ?? '').trim()
  const match = SAFE_IMAGE_DATA_URI.exec(src)

  if (!match) {
    el.remove()
    return
  }
  if (decodedBase64Bytes(match[2] ?? '') > MAX_IMAGE_BYTES) {
    imgCtx.oversized = true
    el.remove()
    return
  }
  imgCtx.count += 1
  if (imgCtx.maxImages !== undefined && imgCtx.count > imgCtx.maxImages) {
    imgCtx.tooMany = true
    el.remove()
  }
})

export function sanitizeOutgoingHtml(html: string, opts: SanitizeOutgoingOptions = {}): string {
  imgCtx = { maxImages: opts.maxImages, count: 0, oversized: false, tooMany: false }

  active = true
  let clean: string
  try {
    clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
      RETURN_TRUSTED_TYPE: false,
    })
  }
  finally {
    active = false
  }

  const { oversized, tooMany } = imgCtx
  imgCtx = { maxImages: undefined, count: 0, oversized: false, tooMany: false }

  if (oversized) throw new OutgoingImageError('Image trop volumineuse (200 Ko max. par image).')
  if (tooMany) throw new OutgoingImageError(`Trop d'images (${opts.maxImages} max.).`)

  // Liens : ouverture sûre chez le destinataire.
  return clean.replace(/<a href=/g, '<a rel="noopener noreferrer" href=')
}

/** Version texte d'un HTML sortant, pour la partie text/plain. */
export function htmlToText(html: string): string {
  return sanitizeOutgoingHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h2|h3|li|blockquote|pre)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<a rel="noopener noreferrer" href="([^"]*)">([^<]*)<\/a>/gi, (_m, href: string, label: string) => (label && label !== href ? `${label} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
