# Passer de Roundcube à Colombe

Colombe se branche sur le même serveur IMAP/SMTP/ManageSieve que Roundcube. Le courrier,
les dossiers et les filtres Sieve restent sur le serveur : rien à migrer de ce côté. Ce
guide couvre le reste : la configuration, les données propres au webmail (contacts,
identités, signatures, réponses types) et la bascule.

Les deux webmails peuvent tourner **en parallèle** pendant toute la transition.

## 1. Reprendre la configuration

```bash
node scripts/colombe-setup.mjs --from-roundcube /etc/roundcube/config.inc.php --out /etc/colombe/colombe.env
```

L'assistant lit `config.inc.php` (et `plugins/managesieve/config.inc.php` à côté s'il
existe) et en déduit :

| Roundcube | Colombe |
|---|---|
| `imap_host` (`ssl://…:993`, `tls://…:143`) ou `default_host` + `default_port` | `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT`, `MAIL_IMAP_SECURE` |
| `smtp_host` (`tls://…:587`, `ssl://…:465`) ou `smtp_server` + `smtp_port` | `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_SECURE` |
| `managesieve_host`, `managesieve_port` | `MAIL_SIEVE_HOST`, `MAIL_SIEVE_PORT` |
| `username_domain` | `MAIL_DOMAINS`, `MAIL_LOGIN_DEFAULT_DOMAIN` (connexion avec le seul identifiant, comme avant) |
| `product_name` | `COLOMBE_ORG_NAME` (proposé) |
| `support_url` | `COLOMBE_SUPPORT_URL` |
| `imap_conn_options` / `smtp_conn_options` avec `verify_peer => false` | **avertissement** : Colombe refuse les certificats non vérifiés en production. Corrigez le certificat, ou utilisez `MAIL_TLS_SERVERNAME` si seul le nom diffère (connexion à `localhost`). |

Les jokers `%n`, `%t`, `%d`, `%s` de Roundcube (hôte déduit du nom de la requête) n'ont
pas d'équivalent : l'assistant vous demande le nom réel.

Il génère aussi les deux secrets, teste les connexions et valide le tout. Vérification à
tout moment : `node scripts/colombe-doctor.mjs --env-file /etc/colombe/colombe.env`.

## 2. Reprendre les données des utilisateurs

Ce qui est repris : **contacts** (y compris les champs de la vCard : téléphones,
organisation, fonction, adresse, anniversaire, notes, adresses supplémentaires),
**groupes de contacts**, **identités** avec leurs **signatures** (HTML ou texte), **réponses
types** (Roundcube 1.5 et plus récents).

Ce qui ne l'est pas : mots de passe (jamais stockés par Colombe), préférences d'affichage,
réponses types des Roundcube antérieurs à 1.5 (enregistrées dans les préférences
sérialisées : l'outil les détecte et le signale). Colombe n'a qu'une adresse d'envoi par
compte : l'adresse d'une identité Roundcube différente de celle du compte est reprise
comme adresse de réponse (`Reply-To`).

### 2.1 Exporter depuis la base de Roundcube

MySQL / MariaDB :

```bash
export MYSQL_PWD='…'          # ou ~/.my.cnf
scripts/roundcube-export/mysql.sh localhost roundcube roundcube /tmp/rc-export
```

PostgreSQL :

```bash
export PGPASSWORD='…'         # ou ~/.pgpass
scripts/roundcube-export/postgres.sh localhost roundcube roundcube /tmp/rc-export
```

SQLite : pas d'export, l'outil lit la base directement (`--sqlite`).

Un fichier `.tsv` par table est écrit dans le dossier. Il contient des données
personnelles : `chmod 700` sur le dossier, et supprimez-le après l'import. Si votre
installation utilise un préfixe de tables (`db_prefix`), adaptez les requêtes de
`scripts/roundcube-export.sql`.

### 2.2 Simuler, puis importer

Colombe doit avoir démarré une fois (création de sa base), puis être **arrêté** pendant
l'import.

```bash
systemctl stop colombe
# Simulation (par défaut) : ce qui serait créé, utilisateur par utilisateur
node scripts/import-roundcube.mjs --from /tmp/rc-export --domain univ-exemple.fr --data-dir /var/lib/colombe
# Import réel
node scripts/import-roundcube.mjs --from /tmp/rc-export --domain univ-exemple.fr --data-dir /var/lib/colombe --apply
chown -R colombe:colombe /var/lib/colombe
systemctl start colombe
```

- `--domain` : ajouté aux identifiants Roundcube sans `@` (quand `username_domain` était
  utilisé).
- `--only a@univ-exemple.fr,b@univ-exemple.fr` : pour commencer par un groupe pilote.
- L'import est **rejouable** : un contact, un groupe, une identité ou une réponse déjà
  présents ne sont pas dupliqués. Vous pouvez donc importer une première fois pour le
  pilote, puis tout le monde le jour de la bascule.
- Chaque utilisateur est importé dans sa propre transaction : une erreur n'en laisse aucun
  à moitié importé.
- Les signatures et réponses HTML sont nettoyées à l'import, puis de nouveau par Colombe à
  chaque lecture.

Avec Docker (après `docker compose stop colombe`) :
`docker compose run --rm -v /tmp/rc-export:/import:ro colombe node scripts/import-roundcube.mjs --from /import --domain univ-exemple.fr --data-dir /data --apply`.

À défaut d'accès à la base, chaque utilisateur peut exporter ses contacts depuis Roundcube
(Contacts → Exporter, fichier `.vcf`) et les importer dans Colombe (Contacts → Importer).

## 3. Filtres Sieve

Les filtres restent sur le serveur et continuent de s'appliquer. Colombe gère ses propres
jeux de filtres (script `colombe` par défaut) et **ne réécrit jamais un script qu'il n'a
pas créé**. Si le script actif d'un utilisateur vient du plugin `managesieve` de Roundcube
(en général `roundcube`), l'onglet Filtres l'indique : l'utilisateur peut le modifier en
mode avancé (script Sieve brut), ou créer un jeu de filtres Colombe et l'activer ; l'ancien
script reste alors sur le serveur, désactivé. Les règles Roundcube ne sont pas converties
automatiquement.

Le transfert est limité aux domaines de `MAIL_FORWARD_DOMAINS`. Si Roundcube autorisait
des redirections vers l'extérieur, décidez-en avant la bascule (voir
[Configuration](/admin/configuration#filtres-reponse-automatique-transfert-sieve)).

## 4. Bascule

1. **Pilote** : Colombe publié à côté de Roundcube (ex. `/colombe/`), annoncé à un groupe
   d'utilisateurs, import `--only` pour eux.
2. **Import général** la veille de la bascule (rejouable).
3. **Redirection** de l'ancienne adresse : décommentez le bloc prévu dans
   `deploy/apache/colombe.conf` ou `deploy/nginx/colombe.conf` (`/roundcube` → `/colombe/`),
   ou publiez directement Colombe sous l'ancien chemin (voir ci-dessous).
4. Gardez Roundcube installé mais inaccessible quelques semaines, puis supprimez-le
   (fichiers, base, configuration Apache).

Pour publier Colombe à l'adresse historique, par exemple `/webmail/` :
`NUXT_APP_BASE_URL=/webmail/` et le même chemin dans le proxy inverse. Aucune
recompilation n'est nécessaire.

## Correspondance des fonctions

| Roundcube | Colombe |
|---|---|
| Plugin `managesieve` (filtres, vacances, transfert) | Paramètres → Filtres, Réponse automatique, Transfert |
| Plugin `archive` | Bouton Archiver, dossier Archives |
| Plugin `zipdownload` | Télécharger les pièces jointes / les messages en zip |
| Plugin `attachment_reminder` | Rappel de pièce jointe oubliée |
| Plugin `newmail_notifier` | Nouveaux messages en direct, notifications du bureau |
| Plugin `password` | Pas de changement de mot de passe dans le webmail : lien `COLOMBE_PASSWORD_RESET_URL` vers l'outil de l'établissement |
| Carnet d'adresses LDAP global | [Annuaire LDAP](/admin/annuaire) (recherche seule, schéma SupAnn/eduPerson) |
| Plugin CAS / authentification centralisée | [Connexion unique OpenID Connect](/admin/connexion-unique) (Keycloak et Apereo CAS 7.1 testés de bout en bout via leur point de terminaison OIDC) |
| Plugin `enigma` (PGP) | Non prévu |
