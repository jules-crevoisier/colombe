# Installation avec Docker

Installe Colombe dans un conteneur Docker, avec un volume pour ses données locales et un
reverse proxy devant pour le HTTPS. Durée : 15 à 30 minutes.

## 0. Avant de commencer

Vérifiez sur votre serveur de messagerie :

- IMAP en **TLS (993)** ou STARTTLS (143), SMTP de **soumission authentifiée** (587 ou
  465) ;
- un certificat valide pour le nom utilisé (Colombe refuse les certificats non vérifiés) ;
- facultatif : **ManageSieve** (Dovecot Pigeonhole, port 4190) pour les filtres, la
  réponse automatique et le transfert ;
- `mail_max_userip_connections` de Dovecot (défaut 10) : chaque session Colombe ouverte
  garde une connexion IMAP (nouveaux messages en direct). Colombe tournant dans son propre
  conteneur, **toutes** les connexions viennent d'une seule IP : augmentez la limite pour
  cette IP, ou de manière globale (ex. `mail_max_userip_connections = 50`).

Générez les deux secrets nécessaires :

```bash
openssl rand -base64 32   # NUXT_SESSION_PASSWORD
openssl rand -base64 32   # WEBMAIL_DATA_KEY (une autre valeur ; à sauvegarder à part)
```

## 1. Récupérer les fichiers

```bash
mkdir -p /opt/colombe && cd /opt/colombe
# Récupérer deploy/docker/docker-compose.yml et deploy/docker/colombe.env.example
cp colombe.env.example colombe.env && chmod 600 colombe.env
```

## 2. Configurer

Remplissez `colombe.env` : au minimum `MAIL_HOST`, `MAIL_DOMAINS`, et les deux secrets
générés ci-dessus. Référence complète : [Configuration](/admin/configuration).

```ini
NODE_ENV=production
MAIL_BACKEND=imap
MAIL_HOST=mail.univ-exemple.fr
MAIL_DOMAINS=univ-exemple.fr
NUXT_SESSION_PASSWORD=<généré ci-dessus>
WEBMAIL_DATA_KEY=<généré ci-dessus, différent>
NUXT_APP_BASE_URL=/
```

## 3. Démarrer

```bash
docker compose up -d
docker compose logs -f colombe   # « Listening on http://0.0.0.0:3000 »
```

Le conteneur écoute sur `127.0.0.1:3000` uniquement, tourne sans privilèges
(`cap_drop: ALL`, `no-new-privileges`), en système de fichiers **en lecture seule** (sauf
`/tmp` et le volume de données), et garde ses données dans le volume `colombe-data`
(monté sur `/data`). État de santé :

```bash
docker inspect --format '{{.State.Health.Status}}' colombe
```

`HEALTHCHECK` interroge `GET /api/health` toutes les 30 secondes.

Pour construire l'image vous-même plutôt que la tirer d'un registre : commentez `image:`
dans `docker-compose.yml`, décommentez `build: ../..`, puis `docker compose build`.

## 4. Contrat de l'image

Stable d'une version à l'autre, pour qui construit ses propres outils autour de
l'image :

| | |
|---|---|
| Répertoire de travail | `/app` |
| Point d'entrée | `node server/index.mjs` |
| Scripts d'administration | `/app/scripts` (voir plus bas) |
| Volume de données | `/data` (`WEBMAIL_DATA_DIR`) |
| Port | `3000` |
| Utilisateur | non root, dédié |
| Vérification de santé | `GET /api/health` |

Exécuter un script d'administration dans le conteneur en production :

```bash
docker compose exec colombe node scripts/colombe-doctor.mjs
```

## 5. Et ensuite

- [Proxy inverse](/admin/proxy-inverse) : HTTPS public, obligatoire avant toute ouverture
  vers l'extérieur.
- [Configuration automatique des logiciels de messagerie](/admin/configuration-automatique)
  (facultatif).
- [Exploitation](/admin/exploitation) : sauvegardes, mises à jour, supervision.
- Reprendre les données d'un Roundcube existant :
  [Migration depuis Roundcube](/admin/migration-roundcube).
