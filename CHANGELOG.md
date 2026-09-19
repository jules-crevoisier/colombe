# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Colombe suit un schéma de version proche de [SemVer](https://semver.org/lang/fr/).

## [1.0.0-rc.6] — 2026-09-19

### Corrigé

- **La langue choisie sur la page de connexion s'applique à toute l'application** : elle est
  enregistrée dans les préférences du compte (si celles-ci sont sur « Automatique »), donc
  conservée après la connexion, au rechargement et sur les autres appareils. Le choix fait
  dans les Paramètres reste prioritaire.

### Ajouté

- **Messages de démonstration en anglais** : un visiteur dont le navigateur est en anglais
  reçoit une boîte d'exemple en anglais (même structure, mêmes pièces jointes, même message
  piégé qui éprouve l'assainisseur), et son compte démarre en anglais.

### Modifié

- Documentation relue avant l'annonce publique : liens corrigés (casse des noms de fichiers),
  variables du mode démonstration ajoutées à `.env.example`, bancs d'essai de connexion
  unique listés dans la page « Contribuer », page d'accueil complétée (connexion unique,
  annuaire, langues).

## [1.0.0-rc.5] — 2026-09-19

### Ajouté

- **Interface en anglais**, à côté du français : réglage « Langue » dans Paramètres →
  Général (automatique selon le navigateur, français, anglais), sélecteur FR | EN sur la
  page de connexion, langue par défaut de l'établissement (`COLOMBE_DEFAULT_LANGUAGE`).
  Messages du serveur, dates, tailles et e-mails envoyés par Colombe suivent la langue
  choisie. Deux tests empêchent toute traduction manquante ou tout texte français oublié.
- **Bancs d'essai de connexion unique sur de vrais serveurs** : Apereo CAS 7.1 (OpenID
  Connect), passerelle SAML (SimpleSAMLphp → Keycloak) pour les fédérations type RENATER,
  et Postfix en soumission SMTP par jeton. La page « Connexion unique » donne les
  configurations exactes vérifiées (`pnpm test:cas`, `test:saml`, `test:postfix`).

### Corrigé

- Deux fautes de français dans des messages (« Seuls les dossiers… », « du dossier Spam »).

## [1.0.0-rc.4] — 2026-09-19

### Ajouté

- **Connexion unique OpenID Connect** (`AUTH_METHODS=oidc`) : bouton « Se connecter avec mon
  compte de l'établissement », compatible CAS 6+, Shibboleth (module OIDC ou passerelle
  SAML), Keycloak, Microsoft Entra, Google Workspace. Accès à la messagerie par **jeton**
  (XOAUTH2 / OAUTHBEARER, validé par Dovecot : aucun mot de passe stocké) ou, en option,
  par utilisateur maître Dovecot. Rafraîchissement des jetons, déconnexion chez le
  fournisseur, ré-authentification pour les actions sensibles, double authentification
  Colombe toujours possible. Testé de bout en bout avec Keycloak 26 et Dovecot 2.4.
- **Annuaire LDAP de l'établissement** (`LDAP_URL`, schéma SupAnn / inetOrgPerson) :
  suggestions dans le champ « À », onglet « Annuaire de l'établissement » dans Contacts,
  ajout aux contacts. Recherche en lecture seule, filtres échappés (RFC 4515), résultats
  limités aux domaines de l'établissement.
- Lien « Retour à l'ENT » (`COLOMBE_PORTAL_URL`).
- Documentation : « Connexion unique » et « Annuaire » (administration), sections
  utilisateur correspondantes.

### Modifié

- Image Docker multi-architecture : étape de compilation native (plus d'émulation arm64),
  construction en quelques minutes.

## [1.0.0-rc.3] — 2026-09-19

### Corrigé

- **Archive de release** : les liens symboliques de dépendances créés par Nitro étaient
  réécrits en chemins absolus de la machine de build ; l'archive ne démarrait pas une fois
  installée sur un serveur Linux. Ils restent désormais relatifs, et la construction de
  l'archive échoue si un lien absolu ou cassé s'y trouve. L'image Docker n'était pas concernée.
- Site de la démo (Dokploy) : adresse de la démo et du site transmises au build.

### Ajouté

- Déclenchement manuel des workflows CI et release (`workflow_dispatch`).

## [1.0.0-rc.2] — 2026-09-19

### Ajouté

- **Licence libre AGPL-3.0** (ou toute version ultérieure).
- **Mode démo public** (`COLOMBE_DEMO=true`) : bouton « Essayer la démo », un compte
  jetable et isolé par visiteur avec des messages d'exemple, effacé après
  `COLOMBE_DEMO_TTL_HOURS` (4 h par défaut) ; connexion par mot de passe désactivée,
  données en mémoire, aucun e-mail ne quitte le serveur.
- **Site du projet et documentation complète** (VitePress, `pnpm docs:build`) : page de
  présentation, guide utilisateur (7 pages), guide d'administration (11 pages),
  contribution. Aucune ressource externe.
- **Déploiement Dokploy** de la démo et du site (`deploy/dokploy/`).
- Intégration continue : construction et test de l'image Docker (santé, utilisateur non
  root, arrêt propre, analyse Trivy) ; SBOM et provenance sur les images publiées.
- Script de déploiement SSH générique (`scripts/deploy-ssh.sh`).

### Modifié

- **Image Docker** sur base distroless Node 24 : 54 Mo compressée (77 Mo auparavant),
  sans shell, utilisateur non root (uid 65532).
- Données de démonstration neutres (`universite.example`), sans référence à un
  établissement réel.
- Documentation réorganisée en pages courtes (`docs/admin/`, `docs/guide/`).

## [1.0.0-rc.1] — 2026-09-19

Première version candidate à la distribution : un webmail pour remplacer Roundcube dans
un établissement (université, entreprise) qui exploite son propre serveur
Dovecot/Postfix, installable en Docker ou en archive, configuré par variables
d'environnement. En production dans un institut universitaire depuis le
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

[1.0.0-rc.6]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.6
[1.0.0-rc.5]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.5
[1.0.0-rc.4]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.4
[1.0.0-rc.3]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/jules-crevoisier/colombe/releases/tag/v1.0.0-rc.1
