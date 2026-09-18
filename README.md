# Courrielle

Webmail moderne pour `mmi-troyes.fr`, conçu pour remplacer RainLoop (abandonné)
puis Roundcube. Interface inspirée de Gmail, pensée d'abord pour le mobile.

> Dépôt privé : `docs/` contient le rapport d'incident et des informations
> d'accès au serveur de messagerie.

## Fonctionnalités

- Lecture, écriture, réponse, transfert, brouillons automatiques, pièces jointes
- Recherche, dossiers (création, renommage, suppression), glisser-déposer
- Vue conversation, éditeur riche, signatures, contacts avec autocomplétion
- Nouveaux messages en direct (IMAP IDLE → SSE), notifications du bureau
- Annuler l'envoi et la suppression, raccourcis clavier façon Gmail
- Double authentification TOTP avec codes de secours
- Mode sombre, accessibilité WCAG 2.2 AA vérifiée (axe)

## Sécurité (non négociable)

- HTML des e-mails assaini par DOMPurify et rendu dans une iframe `sandbox`
  sans scripts ni même origine ; images distantes bloquées par défaut
- Mot de passe IMAP jamais envoyé au navigateur : le cookie scellé ne contient
  qu'un identifiant de session, les identifiants restent en mémoire serveur
- Aucune ressource externe (test automatique qui l'impose)
- Limites de débit : connexion (par adresse et par IP, compatible NAT) et envoi
  (même limite que Postfix)

## Stack

Nuxt 4 (SPA + routes Nitro) · Tailwind 4 · shadcn-vue · Pinia · imapflow ·
nodemailer · mailparser · DOMPurify · TipTap · SQLite intégré à Node (`node:sqlite`)

## Développement

```bash
pnpm install
cp .env.example .env        # MAIL_BACKEND=mock pour travailler sans serveur
docker compose up -d greenmail   # serveur IMAP/SMTP de test (intégration)
pnpm dev
```

Comptes de test (backend mémoire) : `dev@mmi-troyes.fr` / `dev-password`,
`alice@mmi-troyes.fr` / `alice-password`.

| Commande | Contenu |
|---|---|
| `pnpm test` | tests unitaires |
| `pnpm test:integration` | backend IMAP réel contre GreenMail |
| `pnpm test:api` | build de production puis tests de l'API |
| `pnpm test:e2e` | parcours navigateur (application lancée) |
| `pnpm typecheck` | vérification TypeScript |

Plans et état : [docs/PLAN.md](docs/PLAN.md), [docs/PLAN-v2.md](docs/PLAN-v2.md).
