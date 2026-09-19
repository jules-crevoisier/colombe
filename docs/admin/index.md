# Administration — vue d'ensemble

Colombe est un **webmail** : une interface web qui se connecte au serveur de messagerie de
votre établissement (IMAP, SMTP, et ManageSieve pour les filtres). Ce n'est **pas** un
serveur de messagerie : il ne remplace ni Postfix ni Dovecot, ne délivre aucun courrier,
et ne touche à aucune de leurs configurations. Si vous cherchez à installer un serveur de
messagerie, ce n'est pas le bon projet — Colombe vient se brancher sur un serveur déjà en
place.

## Ce que fait Colombe

- Lit et écrit le courrier via IMAP et SMTP, exactement comme Roundcube ou n'importe quel
  client de messagerie.
- Gère les filtres, la réponse automatique et le transfert via ManageSieve (Sieve),
  s'il est disponible.
- Garde localement (base SQLite) ce qui n'existe pas dans IMAP : préférences d'affichage,
  contacts, identités, réponses types, secrets de double authentification. Jamais votre
  mot de passe de messagerie.
- Ne délivre, ne fait transiter et ne stocke aucun message : le courrier reste
  intégralement sur le serveur IMAP.
- Peut déléguer l'authentification à l'annuaire fédéré de l'établissement via
  **connexion unique OpenID Connect** (Keycloak testé ; CAS, Shibboleth, Entra ID, Google
  Workspace documentés mais non testés) — voir [Connexion unique](/admin/connexion-unique).
- Peut interroger l'**annuaire LDAP** de l'établissement (schéma SupAnn/eduPerson) pour
  proposer les personnes de l'établissement dans les destinataires et dans Contacts —
  recherche seule, jamais d'authentification — voir [Annuaire LDAP](/admin/annuaire).

## Architecture

```
┌──────────┐      HTTPS       ┌────────────────────────────┐      IMAP / SMTP / TLS      ┌───────────────┐
│ Navigateur│ ───────────────▶│  Colombe (Nuxt + Nitro)     │ ──────────────────────────▶│ Dovecot        │
│ (SPA)     │◀─────────────── │  process Node unique        │◀──────────────────────────  │ Postfix        │
└──────────┘   cookie session │  - routes /api (serveur)    │   ManageSieve (Sieve, 4190) │ (existant)     │
                (httpOnly)    │  - SQLite locale (.data/)   │ ──────────────────────────▶│               │
                               └────────────────────────────┘                             └───────────────┘
```

Le mot de passe de messagerie transite du navigateur au serveur Colombe (HTTPS), puis de
Colombe au serveur IMAP/SMTP (TLS) : il n'est **jamais** renvoyé au navigateur, ni écrit
sur disque. Il reste en mémoire du processus Colombe le temps de la session. C'est le
choix qui a dicté toute l'architecture : un processus Nitro (routes serveur Nuxt) plutôt
qu'une API séparée, pour qu'il n'y ait qu'un seul endroit où ce mot de passe existe en
clair, jamais exposé au réseau public directement.

Une seule instance Colombe = un seul processus Node. Voir
[Exploitation, §Montée en charge](/admin/exploitation#montee-en-charge) pour ce que cela
implique.

## Prérequis

- **Un serveur de messagerie déjà en place** : IMAP en TLS (993) ou STARTTLS (143), SMTP
  de soumission authentifiée (587 ou 465), avec un certificat TLS valide pour le nom
  utilisé (Colombe refuse par défaut les certificats non vérifiés).
- Facultatif mais recommandé : **ManageSieve** (Dovecot Pigeonhole, port 4190) pour les
  filtres, la réponse automatique et le transfert.
- **Docker** (ou Podman), **ou** **Node.js 24**, pour exécuter Colombe lui-même.
- Un **reverse proxy** (Apache ou Nginx) pour le HTTPS public, dans les deux cas.

## Docker ou archive : comment choisir

| | Docker | Archive (systemd) |
|---|---|---|
| Prérequis | Docker (ou Podman) | Node.js 24 |
| Mise à jour | `docker compose pull && docker compose up -d` | remplacer le dossier, redémarrer |
| Idéal pour | un serveur applicatif séparé du serveur de messagerie | une installation directement sur le serveur de messagerie, à côté d'un Roundcube existant |
| Isolation | conteneur, lecture seule, sans privilèges | processus systemd durci (voir `deploy/systemd/colombe.service`) |

Aucun des deux n'est « la bonne » façon de faire : le choix dépend surtout de vos
habitudes d'exploitation existantes.

## Démarrage en 10 minutes

```bash
# 1. Générer la configuration (secrets, détection des serveurs)
node scripts/colombe-setup.mjs --domain univ-exemple.fr --host mail.univ-exemple.fr

# 2. Vérifier
node scripts/colombe-doctor.mjs

# 3. Démarrer (exemple sans Docker)
node --env-file=.env server/index.mjs
```

Puis un reverse proxy devant, pour le HTTPS public — voir
[Proxy inverse](/admin/proxy-inverse). Le détail pas à pas :
[Installation Docker](/admin/installation-docker) ou
[Installation par archive](/admin/installation-archive).

## Pour aller plus loin

- [Configuration complète](/admin/configuration) — toutes les variables d'environnement
- [Connexion unique (OpenID Connect)](/admin/connexion-unique)
- [Annuaire LDAP de l'établissement](/admin/annuaire)
- [Proxy inverse](/admin/proxy-inverse) — Apache, Nginx, sous-chemin, HTTPS
- [Configuration automatique des logiciels de messagerie](/admin/configuration-automatique)
- [Migration depuis Roundcube](/admin/migration-roundcube)
- [Sécurité](/admin/securite)
- [Exploitation](/admin/exploitation) — sauvegardes, mises à jour, supervision
- [Dépannage](/admin/depannage)
- [Faire une démonstration publique](/admin/demo)
