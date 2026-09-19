# Configuration

Colombe se configure **uniquement par variables d'environnement**, lues au démarrage.
La même archive (ou la même image Docker) sert tous les établissements : rien n'est
figé au moment de la compilation.

- Installation pas à pas : [INSTALLATION.md](INSTALLATION.md)
- Générer le fichier automatiquement (y compris depuis la configuration de Roundcube) :
  `node scripts/colombe-setup.mjs` ; le vérifier : `node scripts/colombe-doctor.mjs`

Au démarrage, **toute** la configuration est validée. Si quelque chose manque ou est
incohérent, Colombe refuse de démarrer et affiche la liste complète des problèmes
(`journalctl -u colombe` ou `docker logs colombe`), par exemple :

```
Configuration invalide :
  - MAIL_DOMAINS est obligatoire : le ou les domaines des adresses de l'établissement (ex. univ-exemple.fr).
  - WEBMAIL_DATA_KEY doit contenir au moins 32 caractères (openssl rand -base64 32), différente de NUXT_SESSION_PASSWORD.
```

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
| `MAIL_HOST` | — (obligatoire) | Serveur IMAP et SMTP. |
| `MAIL_IMAP_HOST` | `MAIL_HOST` | Serveur IMAP, s'il est différent. |
| `MAIL_IMAP_PORT` | `993` | Port IMAP. |
| `MAIL_IMAP_SECURE` | `true` (sauf port 143) | `true` : TLS implicite. `false` : STARTTLS (négocié automatiquement). |
| `MAIL_SMTP_HOST` | `MAIL_HOST` | Serveur d'envoi (soumission), s'il est différent. |
| `MAIL_SMTP_PORT` | `587` | Port de soumission. |
| `MAIL_SMTP_SECURE` | `true` si port 465 | TLS implicite (465). |
| `MAIL_SMTP_REQUIRE_TLS` | `true` | Refuser d'envoyer si STARTTLS n'est pas proposé. |
| `MAIL_TLS_SERVERNAME` | l'hôte | Nom attendu dans le certificat. **Indispensable si Colombe se connecte à `localhost`** alors que le certificat est émis pour `mail.univ-exemple.fr`. |
| `MAIL_TLS_REJECT_UNAUTHORIZED` | `true` | `false` désactive la vérification des certificats : **refusé en production**. |

L'authentification se fait avec le mot de passe de l'utilisateur (PLAIN/LOGIN sur TLS),
comme Roundcube. Colombe ne stocke jamais ce mot de passe sur disque : il reste en
mémoire le temps de la session (8 h au plus, 2 h d'inactivité).

## Connexion des utilisateurs

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_DOMAINS` | — (obligatoire) | Domaines acceptés, séparés par des virgules : `univ-exemple.fr,etu.univ-exemple.fr`. Toute autre adresse est refusée avant même de contacter le serveur. Ancien nom accepté : `MAIL_ALLOWED_DOMAIN`. |
| `MAIL_LOGIN_DEFAULT_DOMAIN` | le domaine, s'il n'y en a qu'un | Domaine ajouté quand l'utilisateur tape seulement son identifiant (équivalent de `username_domain` dans Roundcube). `none` pour exiger l'adresse complète. |
| `MAIL_LOGIN_USERNAME` | `email` | Ce qui est envoyé au serveur IMAP/SMTP : `email` (adresse complète) ou `localpart` (partie avant `@`, pour les serveurs qui authentifient par identifiant). |

## Filtres, réponse automatique, transfert (Sieve)

Nécessitent Dovecot Pigeonhole (`dovecot-sieve`, `dovecot-managesieved`). Sans
ManageSieve, les onglets correspondants indiquent simplement que la fonction n'est pas
disponible.

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_SIEVE_ENABLED` | `true` | `false` masque les filtres sans tenter de connexion. |
| `MAIL_SIEVE_HOST` | `MAIL_IMAP_HOST` | Serveur ManageSieve (souvent `127.0.0.1`). |
| `MAIL_SIEVE_PORT` | `4190` | Port ManageSieve. |
| `MAIL_SIEVE_TLS_SERVERNAME` | `MAIL_TLS_SERVERNAME`, sinon l'hôte IMAP | Nom attendu dans le certificat de ManageSieve. |
| `MAIL_FORWARD_DOMAINS` | `MAIL_DOMAINS` | Seuls domaines vers lesquels un utilisateur peut transférer ou rediriger son courrier. |

> **Transfert vers Gmail ou Outlook.** Ajouter `gmail.com` à `MAIL_FORWARD_DOMAINS`
> permet aux utilisateurs de faire suivre leur courrier vers Gmail. C'est aussi la
> première chose qu'installe un attaquant qui a volé un mot de passe : une règle de
> transfert discrète continue d'exfiltrer le courrier après le changement de mot de
> passe. Colombe en limite le risque (confirmation du mot de passe ou du code de double
> authentification, e-mail d'alerte au titulaire, journal d'activité), mais la décision
> vous revient. Sans transfert, les utilisateurs peuvent toujours consulter leur boîte
> dans l'application Gmail (IMAP) : voir « Autres applications » ci-dessous.

## Autres applications (Gmail, Outlook, iPhone, Thunderbird)

L'onglet **Paramètres → Autres applications** donne à chaque utilisateur les réglages
IMAP/SMTP, un profil de configuration iPhone/iPad et des instructions pas à pas. Colombe
sert aussi la configuration automatique de Thunderbird (`/mail/config-v1.1.xml`) et
d'Outlook (`/autodiscover/autodiscover.xml`) : voir [INSTALLATION.md](INSTALLATION.md)
pour les enregistrements DNS `autoconfig` / `autodiscover`.

Ces paramètres sont ceux que **les utilisateurs** saisissent, qui diffèrent souvent de
ceux qu'utilise Colombe (qui peut se connecter à `localhost`).

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_PUBLIC_HOST` | `MAIL_IMAP_HOST` / `MAIL_SMTP_HOST` s'ils ne sont pas `localhost` | Nom public du serveur de messagerie. |
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
| `COLOMBE_LOGO_FILE` | — | Logo de l'établissement (SVG, PNG, JPEG ou WebP), chemin absolu ou relatif au dossier de travail. |
| `COLOMBE_PASSWORD_RESET_URL` | — | Lien « Mot de passe oublié ? » vers l'outil de votre établissement. |
| `COLOMBE_SUPPORT_URL`, `COLOMBE_SUPPORT_EMAIL` | — | Lien « Besoin d'aide ? ». |

## Données, sessions, réseau

| Variable | Défaut | Rôle |
|---|---|---|
| `NUXT_SESSION_PASSWORD` | — (obligatoire en production) | Clé de chiffrement du cookie de session, 32 caractères au moins. La changer déconnecte tout le monde. |
| `WEBMAIL_DATA_KEY` | — (obligatoire en production) | Clé de chiffrement des secrets de double authentification, **différente** de la précédente. **Sauvegardez-la à part** : sans elle, les utilisateurs devront reconfigurer leur double authentification. |
| `WEBMAIL_DATA_DIR` | `.data` | Dossier de la base SQLite (préférences, contacts, identités, filtres enregistrés, 2FA). |
| `NUXT_APP_BASE_URL` | `/` | Chemin de publication, avec la barre finale : `/colombe/`, `/webmail/`. |
| `HOST`, `PORT` (ou `NITRO_HOST`, `NITRO_PORT`) | `0.0.0.0`, `3000` | Adresse d'écoute. Derrière un proxy inverse : `127.0.0.1`. |
| `MAIL_TRUST_PROXY` | `false` | `true` derrière un proxy inverse : l'IP du client est lue dans `X-Forwarded-For` (limitation des tentatives, journal, fail2ban). Ne l'activez **que** si Colombe n'est joignable que par le proxy. |
| `NODE_ENV` | — | `production` en production (cookies `Secure`, CSP, HSTS, contrôles des secrets). |

## Développement et tests

| Variable | Rôle |
|---|---|
| `MAIL_BACKEND=mock` | Serveur de messagerie simulé en mémoire, comptes de démonstration. **Refusé en production** (sauf `WEBMAIL_ALLOW_MOCK=1`, réservé aux tests automatisés). |
| `WEBMAIL_ALLOW_INSECURE_TLS=1` | Autorise `MAIL_TLS_REJECT_UNAUTHORIZED=false` en production. Tests uniquement. |

## Anciens noms

Les noms `NUXT_MAIL_*` des premières versions (`NUXT_MAIL_HOST`, `NUXT_MAIL_IMAP_PORT`,
`NUXT_MAIL_ALLOWED_DOMAIN`, `NUXT_MAIL_TRUST_PROXY`, `NUXT_MAIL_SIEVE_HOST`,
`NUXT_MAIL_FORWARD_DOMAINS`…) restent acceptés. Les nouveaux noms ont la priorité.
