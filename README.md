# Colombe

Webmail moderne pour les établissements qui exploitent leur propre serveur de messagerie
(Dovecot + Postfix) : universités, écoles, collectivités, entreprises. Conçu pour
remplacer Roundcube (et RainLoop) sans toucher au serveur de messagerie.

Interface inspirée de Gmail, pensée d'abord pour le mobile, sécurisée par défaut. En
production dans un institut universitaire depuis septembre 2026.

**Site : <https://colombe.srko.fr>** · **Démo en ligne : <https://demo.colombe.srko.fr>** (un compte jetable, aucun e-mail ne sort)

*English summary: Colombe is a self-hosted webmail (Nuxt + Node 24) for organisations
running their own IMAP/SMTP server, designed as a Roundcube replacement. Configured
entirely through environment variables; Docker image and release tarball; imports
Roundcube's configuration and user data. The interface is in French for now.*

## Fonctionnalités

- Lecture, écriture, réponse, transfert, brouillons automatiques, pièces jointes
- Recherche, dossiers, glisser-déposer, vue conversation, éditeur riche
- Identités et signatures (avec images), réponses types, contacts et groupes (vCard)
- Filtres façon Gmail, réponse automatique, transfert (Sieve / ManageSieve)
- Nouveaux messages en direct, notifications du bureau, annuler l'envoi
- **Autres applications** : réglages et pas-à-pas pour Gmail, iPhone/iPad (profil de
  configuration), Outlook, Thunderbird, configuration automatique
- Double authentification TOTP, sessions actives, journal des connexions
- Mode sombre, accessibilité WCAG 2.2 AA vérifiée

## Sécurité

HTML des e-mails assaini et isolé dans une `iframe sandbox`, images distantes bloquées,
mot de passe jamais envoyé au navigateur ni écrit sur disque, aucune ressource externe,
limites de débit, transfert limité aux domaines autorisés avec alerte. Détails :
[docs/admin/securite.md](docs/admin/securite.md). Signaler une faille :
[SECURITY.md](SECURITY.md).

## Installer

```bash
# Docker
docker compose -f deploy/docker/docker-compose.yml up -d

# ou archive de release + systemd
node scripts/colombe-setup.mjs --from-roundcube /etc/roundcube/config.inc.php
node scripts/colombe-doctor.mjs
```

| Guide | Contenu |
|---|---|
| [Vue d'ensemble](docs/admin/index.md) | architecture, prérequis, démarrage en 10 minutes |
| [Installation Docker](docs/admin/installation-docker.md) | image, volume, contrat |
| [Installation par archive](docs/admin/installation-archive.md) | Node 24, systemd |
| [Proxy inverse](docs/admin/proxy-inverse.md) | Apache/Nginx, sous-chemin, HTTPS, SSE |
| [Configuration](docs/admin/configuration.md) | toutes les variables d'environnement |
| [Migration depuis Roundcube](docs/admin/migration-roundcube.md) | configuration, contacts, identités, signatures, réponses types, bascule |
| [Sécurité](docs/admin/securite.md) | modèle de sécurité, recommandations |
| [Exploitation](docs/admin/exploitation.md) | sauvegardes, mises à jour, supervision |
| [Guide utilisateur](docs/guide/index.md) | à diffuser aux utilisateurs |

Prérequis : Node.js 24 (ou Docker), un serveur IMAP/SMTP avec TLS ; ManageSieve pour les
filtres.

## Développer

```bash
pnpm install
cp .env.example .env              # MAIL_BACKEND=mock : aucun serveur nécessaire
pnpm dev:mock
```

Comptes de démonstration (backend mémoire) : `dev@universite.example` / `dev-password`,
`alice@universite.example` / `alice-password`.

| Commande | Contenu |
|---|---|
| `pnpm test` | tests unitaires (dont règles de sécurité et d'encodage) |
| `pnpm test:api` | build de production puis tests de l'API |
| `pnpm test:e2e` | parcours navigateur (application lancée) |
| `pnpm test:integration` | backend IMAP réel contre GreenMail (`docker compose up -d greenmail`) |
| `pnpm test:dovecot` | filtres Sieve contre Dovecot (`docker compose up -d dovecot`) |
| `pnpm typecheck` | vérification TypeScript |
| `pnpm release` | archive de release dans `release/` |

Stack : Nuxt 4 (SPA + routes Nitro) · Tailwind 4 · shadcn-vue · Pinia · imapflow ·
nodemailer · mailparser · DOMPurify · TipTap · SQLite intégré à Node (`node:sqlite`).

Historique de conception : [docs/dev/](docs/dev/). Journal des versions :
[CHANGELOG.md](CHANGELOG.md).

## Licence

Colombe est un logiciel libre sous licence [GNU AGPL-3.0](LICENSE) (ou toute version
ultérieure). Vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer ; si vous
proposez une version modifiée en ligne, vous devez en publier le code source.
