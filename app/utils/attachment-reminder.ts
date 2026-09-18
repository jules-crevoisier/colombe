const MENTION = /pi[eè]ces? jointes?|ci-joint|\bPJ\b|en attachement|attached/i
const FORWARD_MARKER = '---------- Message transféré ----------'

/**
 * Le texte rédigé par l'utilisateur évoque-t-il une pièce jointe ?
 * Les citations (réponse) et le message transféré sont ignorés : sinon répondre à
 * « Vous trouverez le relevé en pièce jointe » déclencherait le rappel à tort.
 */
export function mentionsAttachment(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const quote of doc.querySelectorAll('blockquote')) quote.remove()
  const text = doc.body.textContent ?? ''
  const cut = text.indexOf(FORWARD_MARKER)
  return MENTION.test(cut >= 0 ? text.slice(0, cut) : text)
}
