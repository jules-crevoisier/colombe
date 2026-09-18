# Colombe

Webmail libre (AGPL-3.0) pour les établissements qui exploitent leur propre serveur de
messagerie (Dovecot + Postfix). Remplace Roundcube ou RainLoop sans toucher au serveur.
Né après un incident réel : vol d'identifiants et webmail abandonné exposé sur Internet.
La sécurité n'est pas une option de style.

Le contexte propre à un site de production (serveur, accès, historique) vit dans
`CLAUDE.local.md`, jamais dans le dépôt.

## Stack

| Couche | Choix |
|---|---|
| UI | Nuxt 4 (SPA) + Tailwind 4 + shadcn-vue + Pinia |
| API | Routes serveur Nitro (pas de backend séparé) |
| IMAP / SMTP / MIME | `imapflow`, `nodemailer`, `mailparser` |
| Sanitisation HTML | `isomorphic-dompurify` |
| Stockage local | SQLite intégré à Node (`node:sqlite`) |
| Tests | Vitest (unit, API, intégration) + Playwright |

Le mot de passe IMAP ne doit **jamais** atteindre le navigateur : toute la connexion
IMAP/SMTP reste côté serveur.

## Règles de sécurité — non négociables

1. **Tout HTML d'email passe par DOMPurify** avant rendu.
2. **Rendu du corps en `<iframe sandbox>`** (sans `allow-scripts`, sans `allow-same-origin`).
3. **Images distantes bloquées par défaut**, chargées sur action explicite.
4. **Aucun identifiant en `localStorage`/`sessionStorage`.** Session par cookie `httpOnly`
   + `secure` + `sameSite=lax`, chiffré côté serveur.
5. **Aucune ressource externe** (CDN, Google Fonts…) : tout est auto-hébergé. Test automatique.
6. Toute pièce jointe est servie avec `Content-Disposition: attachment` et
   `X-Content-Type-Options: nosniff`.
7. Transfert et redirection limités aux domaines autorisés (`MAIL_FORWARD_DOMAINS`).

## Configuration

Lue **au démarrage** par `server/lib/config/index.ts` (jamais figée au build). Ce fichier,
`server/lib/store/db.ts` et `server/lib/contacts/vcard.ts` sont importés tels quels par les
scripts d'administration via le « type stripping » de Node : syntaxe TypeScript effaçable
uniquement (pas d'`enum`, pas de propriété de paramètre).

## Conventions

- `pnpm`, TypeScript strict (rester en 6.0.x)
- Pas de commit de `.env` — voir `.env.example`
- Documentation : `docs/` (site VitePress), en français
- Tests E2E contre un build de production : `http://localhost:<port>` (cookie `Secure`)
