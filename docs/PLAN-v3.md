# Plan v3 — parité Roundcube

Source : [AUDIT-ROUNDCUBE.md](AUDIT-ROUNDCUBE.md). Trois vagues ; chacune suit le même circuit :

1. **Orchestrateur** : contrat (types partagés, API, libellés d'interface exacts) — ce document.
2. **Agents de développement** (modèle économique) : codent contre le contrat, **n'écrivent pas les tests d'acceptation**.
3. **Agent de test aveugle** (modèle économique) : écrit les tests d'API (boîte noire HTTP) et
   les tests navigateur **à partir de ce document uniquement**, sans lire le code.
4. **Orchestrateur** : exécute toutes les suites, relit le code sensible, corrige, vérifie à l'écran.

Les libellés ci-dessous sont **contractuels** : l'interface doit les employer mot pour mot
(texte visible ou `aria-label`), les tests les utilisent comme sélecteurs accessibles.

---

## Vague R1 — actions sur les messages, recherche, rédaction

### R1.1 Liste : tri, marquer tout comme lu, copier, spam, vider, zip, import

API
- `GET /api/messages` accepte en plus : `sort=date|from|subject|size` (défaut `date`),
  `order=desc|asc` (défaut `desc`).
- `POST /api/folders/mark-read` `{ folder }` → 204 : tous les messages du dossier passent en lu.
- `POST /api/messages/copy` `{ folder, uids, destination }` → 204 (l'original reste en place).
- `POST /api/messages/junk` `{ folder, uids, junk: boolean }` → 204 : `true` déplace vers le
  dossier Spam, `false` vers la Boîte de réception. 404 s'il n'existe pas de dossier Spam.
- `POST /api/folders/empty` `{ folder }` → 204 : suppression définitive de tout le contenu.
  **Uniquement** pour les dossiers Corbeille et Spam, sinon 400.
- `GET /api/messages/zip?folder=…&uids=1,2,3` → archive `.zip` (un `.eml` par message,
  nommé d'après l'objet), `Content-Disposition: attachment`, 200 messages / 100 Mo max (sinon 400).
- `POST /api/messages/import` (multipart : champ `folder`, un ou plusieurs fichiers `.eml`,
  25 Mo au total) → `{ imported: number }`. Un fichier qui n'est pas un message (pas d'en-tête
  `From`/`Date`/`Subject` ni `Message-ID`) est ignoré.

Interface (liste)
- Menu **« Trier »** (bouton icône) : éléments radio **« Date »**, **« Expéditeur »**,
  **« Objet »**, **« Taille »**, puis **« Ordre croissant »** / **« Ordre décroissant »**.
- Menu **« Plus d'actions »** (bouton icône de la barre d'outils) :
  - toujours : **« Marquer tout comme lu »**, **« Importer des messages (.eml) »** ;
  - avec une sélection : **« Copier vers… »** (liste des dossiers), **« Télécharger (.zip) »**,
    **« Signaler comme spam »** (ou **« Ce n'est pas un spam »** dans le dossier Spam).
- Dans Corbeille / Spam : bouton **« Vider la corbeille »** / **« Vider le spam »** →
  confirmation **« Vider »** / **« Annuler »**.

### R1.2 Recherche avancée

API — `GET /api/messages` accepte en plus :
- `fields=subject,from,to,cc,body` (sous-ensemble ; défaut : tous) ;
- `scope=folder|all` (défaut `folder`) — `all` cherche dans tous les dossiers sauf Corbeille
  et Spam ; chaque résultat garde son `folder` ; 200 résultats max ;
- filtres `unread=1`, `flagged=1`, `unanswered=1`, `attachments=1`, `since=AAAA-MM-JJ`,
  `before=AAAA-MM-JJ`. Les filtres fonctionnent aussi **sans** `q`.

Interface
- Bouton **« Options de recherche »** dans le champ de recherche → panneau avec :
  cases **« Objet »**, **« Expéditeur »**, **« Destinataires »**, **« Corps du message »** ;
  choix **« Ce dossier »** / **« Tous les dossiers »** ; filtres **« Non lus »**, **« Suivis »**,
  **« Sans réponse »**, **« Avec pièce jointe »** ; dates **« Du »** et **« Au »** ;
  boutons **« Rechercher »** et **« Réinitialiser »**.
- En portée « Tous les dossiers », chaque résultat affiche le nom de son dossier.

### R1.3 Lecture : impression, source, en-têtes, zip, aperçus, citations

API
- `GET /api/messages/:uid/print?folder=…` → page HTML autonome prête à imprimer (en-têtes +
  corps assaini, images distantes exclues). En-tête `Content-Security-Policy` avec `sandbox`
  et **aucun script autre que l'appel d'impression** (empreinte `sha256`).
- `GET /api/messages/:uid/source?folder=…` → `{ headers: { name: string; value: string }[]; source: string }`
  (`source` tronquée à 1 Mo).
- `GET /api/messages/:uid/raw?folder=…` → message brut, `Content-Disposition: attachment; filename="….eml"`,
  `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`.
- `GET /api/messages/:uid/attachments.zip?folder=…` → toutes les pièces jointes en `.zip`.

Interface (lecture)
- Menu **« Plus d'actions »** : **« Imprimer »** (nouvel onglet), **« Afficher la source »**
  (boîte de dialogue **« Source du message »** avec le texte brut et **« Télécharger (.eml) »**),
  **« Télécharger (.eml) »**, **« Afficher tous les en-têtes »** (liste nom / valeur dans le
  détail des destinataires), **« Copier vers… »**, **« Signaler comme spam »**,
  **« Transférer en pièce jointe »**, **« Rediriger… »**.
- Pièces jointes : un clic sur une image (png, jpeg, gif, webp) ou un fichier texte ouvre
  la boîte **« Aperçu : {nom du fichier} »** avec un bouton **« Télécharger »** ; les autres
  types se téléchargent. Au moins deux pièces jointes → lien **« Tout télécharger (.zip) »**.
  L'aperçu passe par un `Blob` affiché en `<img>` ou `<pre>` : jamais de rendu HTML.
- Texte cité : chaque citation de premier niveau est repliée derrière
  **« Afficher le texte cité »** (`<details>`, sans script dans l'iframe).

### R1.4 Rediriger, transférer en pièce jointe, indicateurs répondu / transféré

API
- `POST /api/messages/:uid/redirect` `{ folder, to: string[] }` → 204 : renvoie le message
  **inchangé** aux nouveaux destinataires avec en-têtes `Resent-From`, `Resent-To`,
  `Resent-Date`, `Resent-Message-ID` ajoutés en tête. Même limite d'envoi que `/api/send`.
- `ComposePayload` accepte :
  - `forwardAsAttachment?: { folder: string; uid: number }[]` → chaque message est joint en
    `message/rfc822` nommé `{objet}.eml` ;
  - `origin?: { folder: string; uid: number; kind: 'reply' | 'forward' }` → après envoi réussi,
    drapeau `\Answered` (réponse) ou `$Forwarded` (transfert) sur le message d'origine.
- `MessageSummary` expose `answered: boolean` et `forwarded: boolean`.

Interface
- Dans la liste, icônes avec libellés accessibles **« Répondu »** et **« Transféré »**.
- **« Rediriger… »** ouvre la boîte **« Rediriger le message »** : champ **« À »** (puces,
  même autocomplétion que la rédaction) et bouton **« Rediriger »**.
- **« Transférer en pièce jointe »** ouvre la rédaction avec la puce `{objet}.eml` jointe
  et l'objet `Tr: {objet}`.

### R1.5 Priorité, accusés de lecture et de remise

API
- `ComposePayload` : `priority?: 'high' | 'normal' | 'low'` (en-têtes `X-Priority` 1/3/5 et
  `Importance`), `requestReadReceipt?: boolean` (`Disposition-Notification-To` = expéditeur),
  `requestDeliveryReceipt?: boolean` (DSN SMTP `NOTIFY=SUCCESS,FAILURE`).
- `MessageSummary.priority: 'high' | 'normal' | 'low'`.
- `MessageDetail.readReceiptTo: Address | null` (présent si demandé **et** pas encore envoyé,
  c'est-à-dire sans drapeau `$MDNSent`).
- `POST /api/messages/:uid/mdn` `{ folder }` → 204 : envoie un accusé de lecture
  (`multipart/report; report-type=disposition-notification`) puis pose `$MDNSent`.
  409 si aucun accusé n'est demandé ou s'il a déjà été envoyé.

Interface
- Rédaction : bouton **« Options d'envoi »** → cases **« Priorité haute »**,
  **« Demander un accusé de lecture »**, **« Demander un accusé de remise »**.
- Liste : icône **« Priorité haute »** sur les messages concernés.
- Lecture : bandeau **« L'expéditeur demande un accusé de lecture. »** avec
  **« Envoyer l'accusé »** et **« Ignorer »**.

### R1.6 Rédaction : glisser-déposer, rappel de pièce jointe, orthographe

- Déposer des fichiers sur la fenêtre de rédaction les joint (zone **« Déposez les fichiers ici »**).
- À l'envoi, si le texte évoque une pièce jointe (« pièce jointe », « ci-joint », « PJ »,
  « en attachement », « attached ») sans fichier joint : boîte **« Pièce jointe oubliée ? »**
  avec **« Ajouter une pièce jointe »** et **« Envoyer quand même »**.
- Correcteur orthographique du navigateur activé en français (`spellcheck`, `lang="fr"`).

### Données de test (backend mémoire)

Le jeu de données de `dev@mmi-troyes.fr` contient notamment :
« La lettre du département — septembre » (HTML, images distantes),
« Relevé de notes — semestre 4 » (PDF joint, suivi), « Maquette avec logo intégré »,
et pour R1 : **« Photos de la sortie »** (deux images PNG jointes + un fichier `notes.txt`),
**« Réunion : merci de confirmer »** (accusé de lecture demandé, priorité haute),
**« Re: Planning »** (contient une citation `<blockquote>`), et un message dans **Spam**.

---

## Vague R2 — identités, réponses types, carnet complet, dossiers, réglages, volet de lecture

Contrat détaillé rédigé à l'issue de R1 : identités (nom, répondre-à, cci, signature par
identité ; adresse d'envoi = identifiant, pour ne jamais permettre l'usurpation), réponses
types, fiches contacts complètes, groupes, import/export vCard et CSV, sous-dossiers,
abonnements, quota et taille des dossiers, choix des dossiers spéciaux, volet de lecture
(aucun / à droite), fuseau et formats de date, délai « marquer comme lu », préférence
HTML/texte, images distantes pour les contacts connus, réglages serveur (vider la corbeille
à la déconnexion…), dernière connexion et sessions actives, pièces jointes vCard.

## Vague R3 — langue (FR / EN) et aide

Internationalisation complète de l'interface et page d'aide.
