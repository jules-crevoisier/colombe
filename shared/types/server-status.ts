/**
 * État du serveur mail, produit toutes les 15 minutes par le script de
 * surveillance du serveur (`mail-sante`, fichier `etat.json`) et relu tel quel
 * par GET /api/admin/server-status, réservé aux administrateurs.
 *
 * Les noms de champs sont ceux du fichier (en français) : c'est le contrat avec
 * le script. Les textes (noms de services, détails, messages d'événements) sont
 * des données rédigées par le script, affichées sans traduction.
 *
 * Chaque bloc secondaire peut valoir null : une évolution ou une erreur partielle
 * du script ne doit jamais rendre la page illisible.
 */

/** Verdict d'ensemble : tout va bien, un point à surveiller, ou une panne. */
export type ServerVerdict = 'ok' | 'attention' | 'panne'

/** Issue de la dernière relance automatique d'un service (null : aucune relance ce passage). */
export type ServiceRestart = 'ok' | 'echec' | 'suspendue'

export interface ServiceProbe {
  /** Ex. « SMTP 25 », « IMAP 993 ». */
  nom: string
  ok: boolean
  /** Explication courte rédigée par le script (code de réponse, erreur). */
  detail: string
}

export interface ServerService {
  /** Unité systemd, ex. « postfix@- ». */
  id: string
  /** Nom affiché, ex. « Postfix ». */
  nom: string
  /** Rôle en une phrase, ex. « Envoi et réception ». */
  role: string
  actif: boolean
  /** Actif et toutes ses sondes répondent. */
  sain: boolean
  /** Démarré depuis (ISO 8601), null s'il est arrêté. */
  depuis: string | null
  tests: ServiceProbe[]
  relance: ServiceRestart | null
  /** Relances automatiques sur les dernières 24 h. */
  relances_24h: number
}

export interface MailQueue {
  /** Tous les messages présents dans la file. */
  total: number
  /** Messages en attente hors messages mis de côté. */
  hors_attente: number
  actifs: number
  differes: number
  /** Messages mis de côté (hold) par l'administrateur, souvent des spams retenus. */
  mis_de_cote: number
  /** Âge du plus ancien message en attente, en minutes ; null si la file est vide. */
  plus_ancien_minutes: number | null
  expediteurs: Array<{ adresse: string, n: number }>
  raisons: Array<{ raison: string, n: number }>
}

export interface MailAccounts {
  total: number
  bloques: number
  actifs: number
  /** Derniers blocages automatiques (7 jours). */
  bloques_recemment: Array<{ le: string, message: string }>
}

/** Compteurs d'une heure (ou du total sur 24 h) lus dans les journaux de Postfix. */
export interface TrafficCounters {
  /** Messages envoyés par les comptes de l'établissement. */
  soumis: number
  /** Messages reçus de l'extérieur. */
  recu: number
  livre_local: number
  livre_externe: number
  differe: number
  rejete: number
  rejet_entrant: number
  /** Refus pour quota d'envoi dépassé. */
  quota: number
  /** Refus pour envoi avec l'adresse de quelqu'un d'autre. */
  usurpation: number
}

export interface TrafficHour extends TrafficCounters {
  /** Libellé rédigé par le script, ex. « 14 h ». */
  heure: string
  /** Début de l'heure (ISO 8601). */
  debut: string
}

export interface MailActivity {
  /** Les 24 dernières heures, de la plus ancienne à la plus récente. */
  heures: TrafficHour[]
  totaux_24h: TrafficCounters
}

export interface Fail2banJail {
  nom: string
  /** Adresses IP bannies en ce moment. */
  bannis: number
  /** Total des bannissements depuis le démarrage de fail2ban. */
  total: number
}

export interface Fail2banStatus {
  jails: Fail2banJail[]
  bannis: number
}

export interface SystemStatus {
  disques: Array<{ point: string, pourcent: number, libre_go: number }>
  certificat: { fichier: string, expire_le: string | null, jours: number | null } | null
}

export interface Blocklist {
  /** Ex. « zen.spamhaus.org ». */
  nom: string
  statut: 'propre' | 'listee' | 'inconnu'
  /** Code de réponse de la liste (ex. « 127.0.0.2 ») ou null. */
  code: string | null
}

export interface Deliverability {
  verifie_le: string | null
  domaine: string
  ip: string
  listes: Blocklist[]
  /** Nom inverse de l'IP (PTR), ou null s'il manque. */
  ptr: string | null
  spf: string | null
  dmarc: string | null
  dkim_selecteur: string | null
  dkim: boolean
}

export type ServerEventLevel = 'info' | 'attention' | 'critique'

export interface ServerEvent {
  /** Date (ISO 8601). */
  t: string
  /** Horodatage Unix en secondes. */
  ts: number
  niveau: ServerEventLevel
  /** Ex. « blocage », « relance », « liste-noire ». */
  type: string
  message: string
}

export interface ServerStatus {
  version: string
  /** Date du dernier passage du script (ISO 8601). */
  genere_le: string
  /** Nom court du serveur. */
  serveur: string
  global: ServerVerdict
  points_attention: string[]
  services: ServerService[]
  file: MailQueue | null
  comptes: MailAccounts | null
  activite: MailActivity | null
  fail2ban: Fail2banStatus | null
  systeme: SystemStatus | null
  delivrabilite: Deliverability | null
  /** 7 derniers jours, du plus récent au plus ancien. */
  evenements: ServerEvent[]
  dernier_rapport: string | null
  /** Intervalle entre deux passages du script, en minutes. */
  intervalle_minutes: number
}

/**
 * Réponse de GET /api/admin/server-status.
 * `available: false` : le fichier n'existe pas encore ou n'est pas lisible
 * (le script n'est pas installé, ou son dernier passage a échoué).
 */
export type ServerStatusResponse =
  | { available: true, status: ServerStatus }
  | { available: false }

/** Réponse de GET /api/admin/access : ce que l'utilisateur connecté peut administrer. */
export interface AdminAccess {
  serverStatus: boolean
}
