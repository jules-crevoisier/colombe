# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Colombe suit un schéma de version proche de [SemVer](https://semver.org/lang/fr/).

## [1.0.0-rc.1] — 2026-09-19

Première version candidate à la distribution : un webmail pour remplacer Roundcube dans
un établissement (université, entreprise) qui exploite son propre serveur
Dovecot/Postfix, installable en Docker ou en archive, configuré par variables
d'environnement. En production à l'IUT de Troyes (département MMI) depuis le
19 septembre 2026.

### Ajouté

#### Messagerie

- Lecture, écriture, réponse, transfert, brouillons automatiques, pièces jointes
- Recherche, gestion des dossiers (création, renommage, suppression), glisser-déposer
- Vue conversation, éditeur riche (TipTap), signatures, import de messages (`.eml`)
- Nouveaux messages en direct (IMAP IDLE → évènements SSE), notifications du bureau
- Annuler l'envoi et la suppression, raccourcis clavier façon Gmail
- Filtres façon Gmail (règles, réponse automatique, transfert) via ManageSieve
- Contacts avec autocomplétion, groupes, import/export vCard
- Export d'une sélection de messages en archive zip

#### Compte et sécurité

- Double authentification TOTP avec codes de secours
- Journal des connexions et des sessions actives
- Mode sombre, accessibilité WCAG 2.2 AA vérifiée (axe)
- HTML des e-mails assaini par DOMPurify, rendu en `<iframe sandbox>` sans
  scripts ni même origine ; images distantes bloquées par défaut
- Mot de passe IMAP jamais envoyé au navigateur (session serveur uniquement) ;
  aucune ressource externe (CDN, polices) ; limites de débit sur la connexion
  et l'envoi
- Transfert limité aux domaines autorisés, avec confirmation, alerte par e-mail
  et journal

#### Autres applications (Gmail, iPhone, Outlook, Thunderbird)

- Onglet « Autres applications » : réglages IMAP/SMTP à copier, pas-à-pas par
  application avec les vraies valeurs, QR code pour ouvrir la page sur le téléphone
- Gmail : application Android/iOS (IMAP), explication de la fin de la relève POP de
  Gmail sur le web (2026), transfert automatique si l'établissement l'autorise,
  « Envoyer des e-mails en tant que »
- Profil de configuration iPhone/iPad (`.mobileconfig`, sans mot de passe)
- Configuration automatique Thunderbird (`/mail/config-v1.1.xml`) et Outlook
  (`/autodiscover/autodiscover.xml`)

#### Installation et configuration

- Identité de l'établissement configurable : nom, logo, message d'accueil, liens
  « Mot de passe oublié ? » et « Besoin d'aide ? »
- Plusieurs domaines, connexion avec le seul identifiant (comme `username_domain`
  de Roundcube), authentification par adresse complète ou par identifiant
- Hôtes IMAP et SMTP distincts, nom de certificat explicite (connexion à `localhost`)
- Limites réglables : envois par compte, tentatives de connexion, taille des pièces
  jointes
- Démarrage refusé, avec la liste de tous les problèmes, si la configuration est
  incomplète ou dangereuse
- Une ligne de journal par échec de connexion, filtre et prison fail2ban fournis
- Configuration entièrement pilotée par variables d'environnement, lue au
  démarrage du serveur (pas de rebuild par établissement) — voir
  `server/lib/config/index.ts` et `.env.example`
- Image Docker multi-architecture (amd64/arm64), `docker-compose.yml` prêt à
  l'emploi (`deploy/docker/`)
- Archive de release (`pnpm release`) : build reproductible sans secret ni
  configuration figée, avec somme de contrôle SHA256
- Fichiers de déploiement bare-metal : service systemd durci, reverse proxy
  Apache et Nginx (dont un chemin dédié aux évènements SSE), configuration
  fail2ban (`deploy/systemd/`, `deploy/apache/`, `deploy/nginx/`,
  `deploy/fail2ban/`)
- Scripts d'administration sans dépendance : `colombe-setup` (assistant, reprise de
  `config.inc.php` de Roundcube, génération des secrets, tests de connexion),
  `colombe-doctor` (diagnostic, test de connexion réel), `import-roundcube`
  (contacts, groupes, identités, signatures, réponses types ; simulation par défaut,
  rejouable)
- Documentation d'administration (`docs/admin/`) et guide utilisateur (`docs/guide/`)
- Point de contrôle `GET /api/health` pour la supervision (Docker
  `HEALTHCHECK`, systemd, répartiteur de charge)
- Intégration continue (tests et vérification des types à chaque changement,
  publication de la release en brouillon sur les tags de version)

[1.0.0-rc.1]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.1
