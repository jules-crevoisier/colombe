/**
 * Forme typée d'un jeu de textes localisé pour `devFixtures` (mock-fixtures.ts).
 * `fr.ts` est la langue source (utilisée telle quelle pour `dev@`/`alice@` et pour
 * toute boîte démo dont la langue résolue est `fr`) ; `en.ts` fournit exactement les
 * mêmes clés, traduites, pour les visiteurs démo dont la langue résolue est `en`
 * (server/lib/i18n : Accept-Language de la requête qui a créé le compte visiteur).
 *
 * Les adresses (`people`, `mailingList.to`, `spam.from`…) gardent toujours le domaine
 * `universite.example` ; seuls le texte visible (objets, corps, noms de rôle comme
 * « Scolarité ») et les libellés d'en-têtes changent d'une langue à l'autre.
 */

/** 8 expéditeurs "Nom Affiché <adresse>", dans l'ordre utilisé par les index `PEOPLE[i]` de devFixtures. */
export type FixturePeople = readonly [string, string, string, string, string, string, string, string]

/** Un sujet de message générique tiré au hasard (les 62 messages de remplissage) + son corps. */
export interface FixtureTopic {
  subject: string
  body: string
}

export interface FixtureLocaleData {
  /** Camille Laurent, Hugo Bernard, Léa Dubois, Scolarité/Registrar, Nathan Moreau, Chloé Petit, Service informatique/IT, Inès Garcia. */
  people: FixturePeople
  /** 10 couples (objet, corps) piochés pseudo-aléatoirement pour les messages de remplissage. */
  topics: readonly FixtureTopic[]
  /** Formule d'ouverture/fermeture des messages de remplissage ("Bonjour," / "Hi,"). */
  greetingOpen: string
  greetingClose: string
  /** Newsletter du campus (HTML avec images distantes + pixel de traçage). */
  newsletter: { subject: string; text: string; html: string }
  /** Message de hameçonnage : seul l'objet est traduit, `html` reste le même payload malveillant (contrat). */
  phishing: { subject: string; html: string }
  /** Relevé de notes (pièce jointe PDF). */
  gradeReport: { subject: string; text: string; filename: string }
  /** Maquette avec logo intégré (image inline, cid:). */
  logoMockup: { subject: string; html: string }
  /** Message au sujet volontairement très long (troncature mobile 320px). */
  longSubject: { subject: string; text: string }
  /** Photos de sortie (pièces jointes multiples + note texte). */
  fieldTrip: { subject: string; text: string; notesFilename: string; notesContent: string }
  /** Réunion avec accusé de lecture demandé (Disposition-Notification-To). */
  meetingConfirm: { subject: string; text: string }
  /** Réponse avec citation imbriquée (blockquote). */
  replyThread: { subject: string; text: string; html: string }
  /** Réponse type des messages du dossier Envoyés (`Re: {sujet}`). */
  sentReplyBody: string
  /** Brouillon non envoyé. */
  draft: { subject: string; text: string }
  /** Corbeille : `Ancienne notification {n}` / corps identique pour les deux messages. */
  trash: { subject: (n: number) => string; text: string }
  /** Dossier Projets : `Projet tutoré — étape {n}` / corps. */
  projects: { subject: (n: number) => string; text: (n: number) => string }
  /** Message de liste de diffusion (List-Id / List-Post). */
  mailingList: { to: string; subject: string; text: string; listId: string; listPost: string }
  /** Carte de visite (pièce jointe .vcf) : seuls ORG/TITLE et le texte du message changent. */
  vcard: { subject: string; text: string; org: string; title: string }
  /** Sous-dossier INBOX.Projets.2026. */
  projectsSubfolder: { subject: string; text: string }
  /** Dossier non abonné "Anciens cours". */
  archives: { subject: string; text: string }
  /** Spam. */
  spam: { from: string; subject: string; text: string }
}
