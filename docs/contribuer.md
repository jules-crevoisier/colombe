# Contribuer

Mise en place du poste de développement, suites de tests, organisation du code, et
processus de publication d'une version.

## Mise en place

```bash
pnpm install
cp .env.example .env              # MAIL_BACKEND=mock : aucun serveur mail nécessaire
pnpm dev:mock
```

Le **backend mock** (`MAIL_BACKEND=mock`) simule un serveur IMAP/SMTP/ManageSieve
entièrement en mémoire : aucun conteneur, aucun réseau, deux comptes de démonstration
prêts à l'emploi — `dev@universite.example` / `dev-password` et
`alice@universite.example` / `alice-password`. C'est le mode de travail par défaut pour
tout ce qui touche à l'interface.

Pour développer contre un vrai serveur IMAP (comportement plus fidèle que le mock, utile
pour la partie serveur) : GreenMail en conteneur.

```bash
docker compose up -d greenmail   # docker-compose.yml à la racine
```

## Suites de tests

| Commande | Ce qu'elle teste | Prérequis |
|---|---|---|
| `pnpm test` | Tests unitaires — dont les règles de sécurité (DOMPurify, iframe sandbox, aucune ressource externe) et de configuration | aucun (backend mock) |
| `pnpm test:api` | API sur un vrai build de production | build automatique via `nuxt build` |
| `pnpm test:e2e` | Parcours navigateur (Playwright), viewports 320 px et 1440 px | application lancée (`pnpm dev`, backend mock) ou `E2E_BASE_URL` défini |
| `pnpm test:integration` | Backend IMAP réel | `docker compose up -d greenmail` |
| `pnpm test:dovecot` | Filtres Sieve contre un vrai Dovecot + Pigeonhole | `docker compose up -d dovecot` ; build automatique |
| `pnpm test:sso` | Connexion unique OpenID Connect contre Keycloak + Dovecot | `docker-compose.sso.yml` ; build automatique |
| `pnpm test:cas` | Connexion unique contre Apereo CAS (protocole OIDC) + Dovecot | `docker-compose.cas.yml` ; build automatique |
| `pnpm test:saml` | Passerelle SAML → OIDC (Keycloak + SimpleSAMLphp) + Dovecot | `docker-compose.saml.yml` ; build automatique |
| `pnpm test:postfix` | Soumission SMTP par connexion unique à travers Postfix | `docker-compose.postfix.yml` |
| `pnpm typecheck` | Vérification TypeScript (`nuxt typecheck`) | aucun |

::: warning E2E : toujours `http://localhost`
Le cookie de session est `Secure` dès que `NODE_ENV=production` : les tests E2E doivent
cibler `http://localhost:<port>` (jamais une IP ni un autre nom d'hôte), sans quoi le
navigateur refuse le cookie et chaque test échoue dès la connexion. Voir
`playwright.config.ts` (`baseURL`, par défaut `http://localhost:3000`).
:::

L'intégration continue (`.github/workflows/ci.yml`) exécute `pnpm typecheck` et `pnpm test`
à chaque push et chaque pull request — les suites plus lourdes (E2E, intégration IMAP/Sieve
réelles) restent à lancer localement avant une contribution significative.

## Organisation du code

| Dossier | Contenu |
|---|---|
| `app/` | Interface Nuxt (SPA) : pages, composants, stores Pinia, composables |
| `server/api/` | Routes serveur Nitro, une par point d'entrée HTTP |
| `server/lib/` | Logique métier (config, IMAP/SMTP, Sieve, contacts, session, stockage) — testée indépendamment de Nitro |
| `server/middleware/`, `server/plugins/` | Contrôle d'origine, autodiscover, garde-fou de démarrage |
| `shared/types/` | Types TypeScript partagés entre `app/` et `server/` (contrat des routes `/api`) |
| `scripts/` | Outils d'administration sans dépendance npm (`colombe-setup`, `colombe-doctor`, `import-roundcube`, `build-release`) |
| `deploy/` | Fichiers de déploiement (systemd, Apache, Nginx, fail2ban, Docker, Dokploy) |
| `tests/` | `unit/`, `api/`, `integration/`, `e2e/`, `a11y/` |
| `docs/` | Cette documentation (site VitePress) |

## Règles de sécurité à respecter dans tout changement

Non négociables, héritées de l'incident qui a motivé ce projet (voir
[Sécurité](/admin/securite)) :

1. Tout HTML d'e-mail passe par DOMPurify avant rendu.
2. Le corps d'un message se rend dans une `<iframe sandbox>`, sans `allow-scripts` ni
   `allow-same-origin`.
3. Les images distantes restent bloquées par défaut.
4. Aucun identifiant en `localStorage`/`sessionStorage`. Session par cookie `httpOnly` +
   `secure` + `sameSite=lax`, chiffré côté serveur.
5. Aucune ressource externe (pas de CDN, pas de polices Google) : tout est auto-hébergé,
   vérifié par un test automatique.
6. Toute pièce jointe est servie avec `Content-Disposition: attachment` et
   `X-Content-Type-Options: nosniff`, jamais rendue inline.
7. Transfert et redirection limités aux domaines de `MAIL_FORWARD_DOMAINS`.

## Convention de commit

```
type | description courte
```

En minuscules, sans point final, moins de 50 caractères pour la description. Types :
`init`, `add`, `update`, `fix`, `refactor`, `remove`, `style`, `docs`, `test`, `config`,
`chore`, `perf`, `security`.

## Publier une version

1. Mettre à jour `version` dans `package.json` et `CHANGELOG.md`, sur `main`.
2. Poser un tag `vX.Y.Z` et le pousser : `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` se déclenche automatiquement :
   - construit l'archive de release (`pnpm release`) et publie un **brouillon** de
     release GitHub avec le tarball et `SHA256SUMS` ;
   - construit et publie l'image Docker multi-architecture (`linux/amd64`,
     `linux/arm64`) sur `ghcr.io/<compte>/colombe`, taguée avec la version, plus `latest`
     si ce n'est pas une préversion (un tag contenant un tiret, ex. `1.0.0-rc.1`, est
     considéré comme une préversion et ne reçoit pas `latest`).
4. Relire et publier le brouillon de release sur GitHub une fois vérifié.

Déploiement d'une nouvelle version sur un serveur par SSH (archive) :
`scripts/deploy-ssh.sh`, voir son en-tête pour les variables (`DEPLOY_HOST` obligatoire).
Il construit proprement (aucune variable d'environnement locale ne fuite dans le build),
vérifie l'absence de secrets dans le paquet (`scripts/check-deploy-secrets.mjs`), envoie
l'archive par `scp`, bascule en conservant l'ancienne version pour un retour arrière
rapide, et contrôle `GET /api/health` après redémarrage.
