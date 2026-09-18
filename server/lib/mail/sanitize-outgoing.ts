import DOMPurify from 'isomorphic-dompurify'

/**
 * Assainissement du HTML SORTANT (éditeur riche, signatures).
 * Liste blanche stricte : uniquement ce que produit l'éditeur. Aucune image
 * distante, aucun style libre — un compte volé ne doit pas pouvoir se servir
 * du webmail pour fabriquer des e-mails de phishing élaborés.
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'pre', 'code', 'hr', 'span', 'div']
const ALLOWED_ATTR = ['href']

export function sanitizeOutgoingHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  })
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
