# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Colombe suit un schéma de version proche de [SemVer](https://semver.org/lang/fr/).

## [1.0.0-rc.1] — 2026-09-19

Première version candidate à la production : remplacement de RainLoop puis
Roundcube sur `mail.mmi-troyes.fr` (voir `docs/incident-mail-2026-09-18.md`),
avec un périmètre fonctionnel complet et une installation reproductible sur
n'importe quel serveur Dovecot/Postfix.

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
- Page « Autres applications » : paramètres IMAP/SMTP pour Gmail, Outlook,
  iPhone, Thunderbird, avec autoconfiguration et autodécouverte
  (`autoconfig`/`autodiscover`) pour les clients qui les supportent

#### Installation et configuration

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
- Scripts d'administration : installation guidée, diagnostic (« doctor »),
  import des données Roundcube
- Point de contrôle `GET /api/health` pour la supervision (Docker
  `HEALTHCHECK`, systemd, répartiteur de charge)
- Intégration continue (tests et vérification des types à chaque changement,
  publication de la release en brouillon sur les tags de version)

[1.0.0-rc.1]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.1
