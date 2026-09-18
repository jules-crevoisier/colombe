# Plan v2 — fonctionnalités avancées

MVP livré et vérifié le 2026-09-18 (unit 248, intégration GreenMail 10, API 18, E2E 24, axe 0).
Choix de l'utilisateur : les 8 fonctionnalités ci-dessous ; **changement de mot de passe hors
webmail** ; préférences en **SQLite local** (`node:sqlite`, sans dépendance native).

## Décisions

| Sujet | Décision |
|---|---|
| Stockage | `node:sqlite`, fichier `WEBMAIL_DATA_DIR/webmail.sqlite` (défaut `.data/`), migrations versionnées |
| Secrets 2FA | chiffrés AES-256-GCM, clé dérivée (HKDF) de `WEBMAIL_DATA_KEY` (≥ 32 car., distincte du mot de passe de session) |
| Éditeur riche | TipTap (MIT), auto-hébergé. HTML sortant **ré-assaini côté serveur** (liste blanche stricte), envoi `multipart/alternative` (texte dérivé) |
| Conversations | pas d'IMAP THREAD côté liste (pagination) : regroupement à l'ouverture — messages liés par `Message-ID` / `References` / `In-Reply-To`, dossier courant + Envoyés |
| Temps réel | SSE `/api/events` authentifié par la session ; une connexion IMAP IDLE par session sur INBOX ; notifications navigateur sur action explicite |
| Filtres / absence | ManageSieve (RFC 5804). **Bloqué** : port 4190 fermé sur le serveur, paquets `dovecot-sieve` + `dovecot-managesieved` à installer par l'admin. Développé contre un conteneur Dovecot de test |
| Annuler | côté client : envoi différé (0/5/10/20 s, réglable) et suppression différée avec « Annuler » dans le toast |
| Contacts | carnet manuel + collecte automatique des destinataires à l'envoi ; autocomplétion par préfixe (nom ou adresse) |
| Mot de passe | hors webmail (décision utilisateur) |

## Lots

| Lot | Contenu | Propriétaire | Dépend de |
|---|---|---|---|
| V2-0 | Contrats (`shared/types`, interface backend), SQLite + migrations, chiffrement | orchestrateur | — |
| V2-1 | Préférences + signatures + contacts : API + collecte à l'envoi | haiku | V2-0 |
| V2-2 | Gestion des dossiers (créer / renommer / supprimer) : backend mock + IMAP + API + tests GreenMail | haiku | V2-0 |
| V2-3 | Conversations : API fil + recherche par en-têtes (mock + IMAP) | haiku | V2-0 |
| V2-4 | Double authentification TOTP (RFC 6238) + codes de secours + étape de connexion | orchestrateur (sécurité) | V2-0 |
| V2-5 | Temps réel : IDLE → SSE, pool de connexions IDLE | haiku, revue orchestrateur | V2-0 |
| V2-6 | UI : éditeur riche, signatures, autocomplétion, page Réglages, gestion dossiers, glisser-déposer, raccourcis j/k/e/#/r/a/f/?, vue conversation, SSE + notifications, annuler | haiku par écran, revue orchestrateur | V2-1…5 |
| V2-7 | Filtres + réponse automatique (Sieve) | après feu vert admin | V2-0 |

Chaque lot : tests écrits d'abord, puis `unit` + `integration` + `api` + typecheck verts,
puis E2E étendu. L'orchestrateur relit tout code touchant à la sécurité (HTML, 2FA, SSE, stockage).

## État au 2026-09-18 (fin de session)

| Lot | État |
|---|---|
| V2-0 contrats, SQLite, chiffrement | ✅ |
| V2-1 préférences, signatures, contacts, envoi HTML | ✅ (upsert contacts et échappement LIKE corrigés en revue) |
| V2-2 gestion des dossiers + glisser-déposer | ✅ (suppression qui perdait la moitié des messages corrigée en revue) |
| V2-3 conversations | ✅ (repli qui téléchargeait tout le dossier supprimé en revue) |
| V2-4 double authentification TOTP | ✅ |
| V2-5 temps réel IDLE → SSE | ✅ (connexion qui restait bloquée sur IDLE + format SSE corrigés en revue) |
| V2-6 interface (éditeur riche, autocomplétion, réglages, raccourcis, annuler) | ✅ |
| V2-7 filtres + réponse automatique (Sieve) | ⛔ bloqué : ManageSieve absent du serveur (port 4190) |

Preuves : unit 386 · intégration GreenMail 20 · API 80 · E2E 38 (320 px + 1440 px) · axe 0 violation
(tous niveaux, écrans v2, clair/sombre) · typecheck 0 · garde-fous : aucune ressource externe, templates Vue valides.
