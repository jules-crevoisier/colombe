/** Échappement HTML (texte → contenu sûr pour l'éditeur). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Texte brut → paragraphes HTML (lignes vides = nouveau paragraphe, retours simples = <br>). */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Bloc signature placé sous le corps, précédé du séparateur usuel « -- ». */
export function signatureBlock(signatureHtml: string): string {
  return signatureHtml.trim() ? `<p>--</p>${signatureHtml}` : ''
}
