const MENTION = /pi[eè]ces? jointes?|ci-joint|\bPJ\b|en attachement|attached|attachment|enclosed/i
/** Séparateur inséré avant un message transféré, dans chaque langue de l'interface (compose.quote.forwardMarker). */
const FORWARD_MARKERS = ['---------- Message transféré ----------', '---------- Forwarded message ----------']

/**
 * Le texte rédigé par l'utilisateur évoque-t-il une pièce jointe ?
 * Les citations (réponse) et le message transféré sont ignorés : sinon répondre à
 * « Vous trouverez le relevé en pièce jointe » déclencherait le rappel à tort.
 */
export function mentionsAttachment(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const quote of doc.querySelectorAll('blockquote')) quote.remove()
  const text = doc.body.textContent ?? ''
  const cuts = FORWARD_MARKERS.map(marker => text.indexOf(marker)).filter(i => i >= 0)
  return MENTION.test(cuts.length ? text.slice(0, Math.min(...cuts)) : text)
}
