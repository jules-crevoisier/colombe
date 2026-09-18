# Plan — webmail-mmi (MVP + recherche + brouillons)

Objectif : un webmail fonctionnel équivalent Roundcube, interface façon Gmail
(Material 3), Nuxt 4 + Tailwind 4 + shadcn-vue. Règles de sécurité : voir `CLAUDE.md`.

## Décisions verrouillées

- Direction visuelle : Gmail / Material 3 via shadcn-vue, tokens dans `app/assets/css/tailwind.css`
  (`bg-surface-app`, `bg-surface-panel`, `bg-compose`, `bg-nav-active`, `bg-row-read`, `bg-row-selected`, `bg-search`).
- Police Inter auto-hébergée (`@fontsource-variable/inter`). Icônes `@lucide/vue`. **Aucun CDN.**
- Dev et tests contre un **backend mémoire** (`MAIL_BACKEND=mock`), jamais contre le vrai serveur
  (limite 20 msg / 900 s + ban fail2ban 24 h). Le vrai serveur n'est utilisé qu'en test manuel final.
- Mot de passe IMAP : **jamais dans le cookie, jamais dans le navigateur**. Le cookie scellé
  (`nuxt-auth-utils`) ne contient que `{ user: { email }, secure: { sid } }`. Le mot de passe vit
  dans un magasin mémoire serveur indexé par `sid` (perdu au redémarrage = reconnexion).
- Mobile-first : 320 px d'abord, puis 768 / 1024 / 1440.

## Arborescence

```
shared/types/mail.ts          contrat client ↔ serveur (FIGÉ)
server/lib/mail/backend.ts    interface MailBackend (FIGÉE)
server/lib/mail/mock.ts       backend mémoire + jeu de données          [lot A]
server/lib/mail/imap.ts       backend imapflow + nodemailer             [lot A]
server/lib/mail/parse.ts      RFC822 → MessageDetail (mailparser)       [lot A]
server/lib/mail/sanitize.ts   DOMPurify + neutralisation images         [lot A]
server/lib/mail/compose.ts    ComposePayload → RFC822 (MailComposer)    [lot A]
server/lib/mail/index.ts      fabrique createBackend / verifyCredentials [lot A]
server/lib/session/*          magasin d'identifiants, pool, rate-limit   [lot B]
server/utils/mail-session.ts  requireMail(event) (auto-import Nitro)    [lot B]
server/middleware/*           contrôle Origin sur requêtes mutantes     [lot B]
server/api/**                 routes                                    [lot B]
app/**                        interface                                 [lot C]
tests/unit/**                 Vitest unitaires (lot A, lot B)
tests/api/**                  Vitest + @nuxt/test-utils, serveur réel en mode mock [lot B]
tests/e2e/**                  Playwright                                [lot D]
```

## Signatures des modules du lot A (figées pour que B et C puissent coder en parallèle)

```ts
// server/lib/mail/index.ts
export type BackendKind = 'imap' | 'mock'
export function createBackend(kind: BackendKind, creds: MailCredentials, config: MailServerConfig): MailBackend
export function verifyCredentials(kind: BackendKind, creds: MailCredentials, config: MailServerConfig): Promise<boolean>

// server/lib/mail/mock.ts
export const MOCK_USERS: ReadonlyArray<{ email: string; password: string; name: string }>
//   dev@mmi-troyes.fr / dev-password ; alice@mmi-troyes.fr / alice-password
export function resetMockStore(): void
export class MockBackend implements MailBackend { constructor(email: string) }

// server/lib/mail/parse.ts
export interface MessageContext { uid: number; folder: string; seen: boolean; flagged: boolean; size: number }
export function parseMessage(raw: Buffer, ctx: MessageContext): Promise<MessageDetail>
export function getAttachment(raw: Buffer, id: string): Promise<{ filename: string; content: Buffer } | null>

// server/lib/mail/sanitize.ts
export function sanitizeEmailHtml(html: string, inlineImages: Record<string, string>): { html: string; remoteImages: number }

// server/lib/mail/compose.ts
export function buildRawMessage(from: string, payload: ComposePayload): Promise<Buffer>
```

## API (lot B)

Toutes les routes sauf login exigent une session → sinon `401`. Toute requête non-GET dont
l'en-tête `Origin` ne correspond pas à l'hôte → `403`.

| Méthode | Route | Entrée | Sortie |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `200 { user: { email } }` · `400` · `401` · `403` domaine refusé · `429` |
| POST | `/api/auth/logout` | — | `204` |
| GET | `/api/_auth/session` | (fourni par nuxt-auth-utils) | session publique |
| GET | `/api/folders` | — | `Folder[]` (ordre : Boîte de réception, Envoyés, Brouillons, Archives, Spam, Corbeille, puis perso A→Z) |
| GET | `/api/messages` | `?folder&page=1&pageSize=50&q=` | `MessagePage` (pageSize ≤ 100) |
| GET | `/api/messages/:uid` | `?folder` | `MessageDetail` — marque comme lu |
| GET | `/api/messages/:uid/attachments/:id` | `?folder` | binaire, `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename*=UTF-8''…`, `X-Content-Type-Options: nosniff` |
| POST | `/api/messages/flags` | `{ folder, uids, seen?, flagged? }` | `204` |
| POST | `/api/messages/move` | `{ folder, uids, destination }` | `204` |
| POST | `/api/messages/delete` | `{ folder, uids }` | `204` — vers Corbeille ; définitif si déjà dans Corbeille |
| POST | `/api/send` | `ComposePayload` | `204` — copie dans Envoyés (`\Seen`), supprime `draftUid` |
| POST | `/api/drafts` | `ComposePayload` | `DraftSaveResult` — remplace `draftUid` |
| POST | `/api/__mock/reset` | — | `204` en mode mock uniquement, `404` sinon |

Limites : connexion 5 échecs / 15 min par IP **et** par adresse → `429`. Corps d'envoi ≤ 15 Mo.
Destinataires : ≥ 1, adresses valides, ≤ 100 au total.

## Interface (lot C)

- `/login` — carte centrée, logo, e-mail + mot de passe, erreurs lisibles (401 / 429).
- `/mail/:folder` — liste ; `/mail/:folder/:uid` — lecture. `:folder` = chemin IMAP encodé URI.
- Middleware global : non connecté → `/login` ; `/` → `/mail/INBOX`.
- En-tête : menu, logo, champ recherche arrondi (`bg-search`), avatar → e-mail, thème clair/sombre, déconnexion.
- Barre latérale : bouton tonal « Nouveau message » (`bg-compose`), dossiers avec icône, compteur non-lus,
  élément actif en pilule `bg-nav-active`. < 1024 px : tiroir `Sheet` + FAB « Nouveau message ».
- Liste : barre d'outils (tout cocher, actualiser, lu/non lu, supprimer, déplacer, pagination « 1–50 sur N »).
  Mobile : avatar initiales, expéditeur, date, sujet, extrait. ≥ 1024 : ligne unique (case, étoile,
  expéditeur, sujet — extrait, trombone, date). Non lu = gras sur `bg-surface-panel`, lu = `bg-row-read`.
  États : chargement (squelettes), vide, erreur + réessayer.
- Lecture : sujet, expéditeur, destinataires, date ; bandeau « Images distantes masquées — Afficher » ;
  corps en `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">` + `srcdoc` avec
  `<meta http-equiv="Content-Security-Policy">` (img-src `data:` par défaut, `data: https:` après clic),
  `<base target="_blank">` ; texte brut en `<pre>`. Pièces jointes en puces téléchargeables.
  Boutons Répondre / Répondre à tous / Transférer. Brouillon ouvert → éditeur prérempli.
- Éditeur : fenêtre flottante en bas à droite ≥ 1024 px, plein écran en mobile. À / Cc / Cci en
  puces, Objet, corps texte, pièces jointes (≤ 10 Mo au total), sauvegarde auto du brouillon
  (3 s après la dernière frappe), Envoyer, Supprimer le brouillon. Toast à l'envoi.
- Raccourcis : `c` nouveau message, `/` recherche. Tap targets ≥ 44 px, inputs ≥ 16 px.

## Lots et agents

| Lot | Agent (Haiku) | Dépend de | Preuve de fin |
|---|---|---|---|
| A | backend-core | contrat | `pnpm vitest run --project unit` vert, tests écrits avant le code |
| C | ui | contrat + API ci-dessus | `nuxt typecheck` propre, pages rendues |
| B | api | A | `pnpm vitest run --project api` vert |
| D | e2e + a11y | A B C | Playwright vert à 320 / 1024 ; rapport a11y |
| — | orchestrateur (Opus) | chaque lot | relecture de code, tests relancés, contrôle navigateur |

## Hors périmètre de cette passe

Fils de discussion, éditeur riche, signatures, changement de mot de passe, filtres, contacts,
transfert des pièces jointes d'origine, CSP à nonce (le script inline de Nuxt impose `'unsafe-inline'`).
