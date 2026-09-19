# Colombe

Webmail moderne pour les établissements qui exploitent leur propre serveur de messagerie
(Dovecot + Postfix) : universités, écoles, collectivités, entreprises. Conçu pour
remplacer Roundcube (et RainLoop) sans toucher au serveur de messagerie.

Interface inspirée de Gmail, pensée d'abord pour le mobile, sécurisée par défaut. En
production à l'IUT de Troyes depuis septembre 2026.

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
[docs/admin/SECURITE.md](docs/admin/SECURITE.md). Signaler une faille :
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
| [Installation](docs/admin/INSTALLATION.md) | Docker ou systemd, proxy Apache/Nginx, configuration automatique, fail2ban, sauvegardes, mises à jour |
| [Configuration](docs/admin/CONFIGURATION.md) | toutes les variables d'environnement |
| [Migration depuis Roundcube](docs/admin/MIGRATION-ROUNDCUBE.md) | configuration, contacts, identités, signatures, réponses types, bascule |
| [Sécurité](docs/admin/SECURITE.md) | modèle de sécurité, recommandations |
| [Guide utilisateur : Gmail et autres applications](docs/guide/AUTRES-APPLICATIONS.md) | à diffuser aux utilisateurs |

Prérequis : Node.js 24 (ou Docker), un serveur IMAP/SMTP avec TLS ; ManageSieve pour les
filtres.

## Développer

```bash
pnpm install
cp .env.example .env              # MAIL_BACKEND=mock : aucun serveur nécessaire
pnpm dev:mock
```

Comptes de démonstration (backend mémoire) : `dev@mmi-troyes.fr` / `dev-password`,
`alice@mmi-troyes.fr` / `alice-password`.

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
