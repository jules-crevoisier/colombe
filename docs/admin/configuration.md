# Configuration

Colombe se configure **uniquement par variables d'environnement**, lues au démarrage du
processus (`server/lib/config/index.ts`). La même archive (ou la même image Docker) sert
tous les établissements : rien n'est figé au moment de la compilation — changer la
configuration ne demande jamais de reconstruire.

- Installation pas à pas : [Docker](/admin/installation-docker) ou
  [archive](/admin/installation-archive).
- Générer le fichier automatiquement (y compris depuis la configuration de Roundcube) :
  `node scripts/colombe-setup.mjs` ; le vérifier ensuite : `node scripts/colombe-doctor.mjs`.
- Fichier d'exemple complet, commenté : `.env.example` à la racine du dépôt.

::: warning Démarrage refusé si la configuration est invalide
Au démarrage, **toute** la configuration est validée d'un coup. Si quelque chose manque ou
est incohérent, Colombe refuse de démarrer et affiche la liste **complète** des problèmes
(visible dans `journalctl -u colombe` ou `docker logs colombe`) plutôt qu'un message
isolé, par exemple :

```
Configuration invalide :
  - MAIL_DOMAINS est obligatoire : le ou les domaines des adresses de l'établissement (ex. univ-exemple.fr).
  - WEBMAIL_DATA_KEY doit contenir au moins 32 caractères (openssl rand -base64 32), différente de NUXT_SESSION_PASSWORD.
```

Voir [Dépannage](/admin/depannage#colombe-refuse-de-demarrer) pour la marche à suivre.
:::

## Le minimum

```ini
NODE_ENV=production
MAIL_HOST=mail.univ-exemple.fr
MAIL_DOMAINS=univ-exemple.fr
NUXT_SESSION_PASSWORD=<openssl rand -base64 32>
WEBMAIL_DATA_KEY=<openssl rand -base64 32, une AUTRE valeur>
WEBMAIL_DATA_DIR=/var/lib/colombe
```

Avec ces six lignes : IMAP en TLS sur 993, SMTP en STARTTLS sur 587, filtres Sieve sur
4190 s'ils sont disponibles, connexion avec `prenom.nom@univ-exemple.fr` **ou** simplement
`prenom.nom`.

## Serveur de messagerie

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_HOST` | — (obligatoire) | Serveur IMAP et SMTP, si identiques. |
| `MAIL_IMAP_HOST` | `MAIL_HOST` | Serveur IMAP, s'il est différent. |
| `MAIL_IMAP_PORT` | `993` | Port IMAP. |
| `MAIL_IMAP_SECURE` | `true` (sauf port `143`) | `true` : TLS implicite. `false` : STARTTLS (négocié automatiquement). |
| `MAIL_SMTP_HOST` | `MAIL_HOST` | Serveur d'envoi (soumission), s'il est différent. |
| `MAIL_SMTP_PORT` | `587` | Port de soumission. |
| `MAIL_SMTP_SECURE` | `true` si le port est `465` | TLS implicite. |
| `MAIL_SMTP_REQUIRE_TLS` | `true` | Refuser d'envoyer si STARTTLS n'est pas proposé (ignoré si `MAIL_SMTP_SECURE`). |
| `MAIL_TLS_SERVERNAME` | l'hôte IMAP/SMTP | Nom attendu dans le certificat (SNI + vérification). **Indispensable si Colombe se connecte à `localhost`** alors que le certificat est émis pour `mail.univ-exemple.fr`. |
| `MAIL_TLS_REJECT_UNAUTHORIZED` | `true` | `false` désactive la vérification des certificats : **refusé en production** sauf `WEBMAIL_ALLOW_INSECURE_TLS=1`. |

L'authentification se fait avec le mot de passe de l'utilisateur (PLAIN/LOGIN sur TLS),
comme Roundcube. Colombe ne stocke jamais ce mot de passe sur disque : il reste en
mémoire le temps de la session.

## Connexion des utilisateurs

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_DOMAINS` | — (obligatoire avec `MAIL_BACKEND=imap`) | Domaines acceptés, séparés par des virgules/espaces : `univ-exemple.fr,etu.univ-exemple.fr`. Toute autre adresse est refusée avant même de contacter le serveur. Ancien nom accepté : `MAIL_ALLOWED_DOMAIN`. |
| `MAIL_LOGIN_DEFAULT_DOMAIN` | le domaine, s'il n'y en a qu'un | Domaine ajouté quand l'utilisateur ne saisit que son identifiant (équivalent de `username_domain` dans Roundcube). `none` pour exiger l'adresse complète même avec un seul domaine. |
| `MAIL_LOGIN_USERNAME` | `email` | Ce qui est envoyé au serveur IMAP/SMTP/ManageSieve : `email` (adresse complète) ou `localpart` (partie avant `@`, pour les serveurs qui authentifient par identifiant). |

## Filtres, réponse automatique, transfert (Sieve)

Nécessitent Dovecot Pigeonhole (`dovecot-sieve`, `dovecot-managesieved`). Sans
ManageSieve, les onglets correspondants indiquent simplement que la fonction n'est pas
disponible — voir [Dépannage](/admin/depannage#filtres-indisponibles-managesieve).

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_SIEVE_ENABLED` | `true` | `false` masque les filtres côté interface, sans tenter aucune connexion. |
| `MAIL_SIEVE_HOST` | `MAIL_IMAP_HOST` | Serveur ManageSieve (souvent `127.0.0.1`). |
| `MAIL_SIEVE_PORT` | `4190` | Port ManageSieve. |
| `MAIL_SIEVE_TLS_SERVERNAME` | `MAIL_TLS_SERVERNAME`, sinon l'hôte IMAP | Nom attendu dans le certificat de ManageSieve, si différent (utile quand ManageSieve écoute en `127.0.0.1`). |
| `MAIL_FORWARD_DOMAINS` | `MAIL_DOMAINS` | Seuls domaines vers lesquels un utilisateur peut transférer ou rediriger son courrier. |

::: warning Transfert vers Gmail ou Outlook
Ajouter `gmail.com` à `MAIL_FORWARD_DOMAINS` permet aux utilisateurs de faire suivre leur
courrier vers Gmail. C'est aussi la première chose qu'installe un attaquant qui a volé un
mot de passe : une règle de transfert discrète continue d'exfiltrer le courrier après le
changement de mot de passe. Colombe en limite le risque (confirmation du mot de passe ou
du code de double authentification, e-mail d'alerte au titulaire, journal d'activité),
mais la décision vous revient. Sans transfert, les utilisateurs peuvent toujours consulter
leur boîte dans l'application Gmail (IMAP) : voir
[Autres applications](/guide/autres-applications).
:::

## Paramètres publics (autres logiciels)

Ce que **les utilisateurs** saisissent dans un autre logiciel de messagerie, qui diffère
souvent de ce qu'utilise Colombe lui-même (qui peut se connecter à `localhost`). L'onglet
**Paramètres → Autres applications** les affiche ; voir aussi
[Configuration automatique](/admin/configuration-automatique).

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_PUBLIC_HOST` | `MAIL_IMAP_HOST`/`MAIL_SMTP_HOST`, s'ils ne sont pas en boucle locale | Nom public du serveur de messagerie. |
| `MAIL_PUBLIC_IMAP_HOST`, `MAIL_PUBLIC_SMTP_HOST` | `MAIL_PUBLIC_HOST` | Si l'IMAP et le SMTP publics sont sur des noms différents. |
| `MAIL_PUBLIC_IMAP_PORT`, `MAIL_PUBLIC_SMTP_PORT` | ports internes | Ports publics. La sécurité affichée (SSL/TLS ou STARTTLS) en est déduite (993 et 465 : SSL/TLS). |

Si aucun nom public n'est connu (Colombe configuré sur `localhost` sans
`MAIL_PUBLIC_HOST`), la page l'indique et la configuration automatique répond 404.

## Identité de l'établissement

| Variable | Défaut | Rôle |
|---|---|---|
| `COLOMBE_NAME` | `Colombe` | Nom du produit (titre des pages). |
| `COLOMBE_ORG_NAME` | — | Nom de l'établissement, affiché sur la page de connexion. |
| `COLOMBE_LOGIN_MESSAGE` | — | Phrase sous le titre de la page de connexion. |
| `COLOMBE_LOGO_FILE` | — | Logo de l'établissement (`.svg`, `.png`, `.jpg` ou `.webp`), chemin absolu ou relatif au dossier de travail. Servi par `GET /api/branding/logo`. |
| `COLOMBE_PASSWORD_RESET_URL` | — | Lien « Mot de passe oublié ? » vers l'outil de votre établissement (Colombe ne change aucun mot de passe). |
| `COLOMBE_SUPPORT_URL`, `COLOMBE_SUPPORT_EMAIL` | — | Lien « Besoin d'aide ? ». |

## Limites

Compteurs sur une fenêtre de 15 minutes glissante, **par processus** (voir
[Exploitation, §Montée en charge](/admin/exploitation#montee-en-charge)).

| Variable | Défaut | Rôle |
|---|---|---|
| `COLOMBE_SEND_LIMIT` | `20` | Messages envoyés par compte. Alignez-la sur la politique de Postfix : un compte volé ne doit pas devenir un relais de spam par le webmail. |
| `COLOMBE_LOGIN_LIMIT_ACCOUNT` | `5` | Échecs de connexion par adresse avant blocage temporaire. |
| `COLOMBE_LOGIN_LIMIT_IP` | `30` | Échecs par IP. Volontairement plus large : un établissement entier sort souvent par une seule IP (NAT). |
| `COLOMBE_MAX_ATTACHMENTS_MB` | `10` | Total des pièces jointes d'un message. Restez sous `message_size_limit` de Postfix (le codage base64 ajoute environ 35 %) et ajustez `client_max_body_size` de Nginx en conséquence — voir [Proxy inverse](/admin/proxy-inverse#taille-des-pieces-jointes). |

## Données, sessions, réseau

| Variable | Défaut | Rôle |
|---|---|---|
| `NUXT_SESSION_PASSWORD` | — (obligatoire en production, 32 caractères mini.) | Clé de chiffrement du cookie de session. La changer déconnecte tout le monde. |
| `WEBMAIL_DATA_KEY` | — (obligatoire en production, 32 caractères mini., **différente** de la précédente) | Clé de chiffrement des secrets de double authentification. **Sauvegardez-la à part** : sans elle, les utilisateurs devront reconfigurer leur double authentification. |
| `WEBMAIL_DATA_DIR` | `.data` | Dossier de la base SQLite locale (préférences, contacts, identités, réponses types, filtres enregistrés, 2FA). Résolu par rapport au dossier de travail si relatif. |
| `NUXT_APP_BASE_URL` | `/` | Chemin de publication, **avec la barre finale** : `/colombe/`, `/webmail/`. Lu au runtime par Nuxt (pas par `server/lib/config`) : pas de recompilation pour en changer. |
| `HOST`, `PORT` (ou `NITRO_HOST`, `NITRO_PORT`) | `0.0.0.0`, `3000` | Adresse d'écoute du processus. Derrière un reverse proxy : `127.0.0.1`. |
| `MAIL_TRUST_PROXY` | `false` | `true` derrière un reverse proxy de confiance : l'IP du client est lue dans `X-Forwarded-For` (limitation des tentatives, journal, fail2ban). Ne l'activez **que** si Colombe n'est joignable que par ce proxy. |
| `NODE_ENV` | — | `production` en production : active les cookies `Secure`, les vérifications de secrets, et interdit le backend `mock` et les certificats non vérifiés sauf dérogation explicite. |

## Mode démonstration

`COLOMBE_DEMO` et les variables associées créent des comptes visiteurs temporaires,
isolés, pour faire essayer Colombe sans toucher à un vrai serveur de messagerie. Détail
complet, y compris la pile Docker dédiée : [Faire une démonstration publique](/admin/demo).

| Variable | Défaut | Rôle |
|---|---|---|
| `COLOMBE_DEMO` | `false` | Active le mode démonstration. Exige `MAIL_BACKEND=mock` ; exige toujours `NUXT_SESSION_PASSWORD` et `WEBMAIL_DATA_KEY`, même en démonstration. Autorisé en production sans `WEBMAIL_ALLOW_MOCK`. |
| `COLOMBE_DEMO_TTL_HOURS` | `4` | Durée de vie d'un compte de démonstration avant suppression automatique. |
| `COLOMBE_DEMO_MAX_ACCOUNTS` | `200` | Nombre maximal de comptes de démonstration simultanés. |
| `COLOMBE_PROJECT_URL` | — | Lien vers le projet, affiché aux visiteurs de la démonstration. |

En mode démonstration, toutes les données sont en mémoire : `WEBMAIL_DATA_DIR` est
ignoré, rien n'est écrit sur disque.

## Développement et tests

| Variable | Rôle |
|---|---|
| `MAIL_BACKEND=mock` | Serveur de messagerie simulé en mémoire, comptes de démonstration, sans réseau. **Refusé en production** sauf `WEBMAIL_ALLOW_MOCK=1` (réservé aux tests automatisés et démonstrations) ou `COLOMBE_DEMO=true`. |
| `WEBMAIL_ALLOW_INSECURE_TLS=1` | Autorise `MAIL_TLS_REJECT_UNAUTHORIZED=false` en production. Tests uniquement. |

## Anciens noms

Les noms `NUXT_MAIL_*` des premières versions (`NUXT_MAIL_HOST`, `NUXT_MAIL_IMAP_PORT`,
`NUXT_MAIL_ALLOWED_DOMAIN`, `NUXT_MAIL_TRUST_PROXY`, `NUXT_MAIL_SIEVE_HOST`,
`NUXT_MAIL_FORWARD_DOMAINS`…) restent acceptés comme alias. Les nouveaux noms (sans le
préfixe `NUXT_MAIL_`) ont la priorité s'ils sont tous les deux définis.
