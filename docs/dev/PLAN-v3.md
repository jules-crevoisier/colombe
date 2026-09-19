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

### R2.1 Identités

Une identité = nom affiché, répondre-à, cci automatique, organisation, signature. L'adresse
d'expédition reste **toujours** l'identifiant de connexion (le serveur refuse tout autre
`From`) : un compte volé ne doit pas pouvoir usurper une autre adresse.

API
- `GET /api/identities` → `Identity[]` (au moins une : créée automatiquement à la première
  lecture avec `name` = partie locale de l'adresse, `isDefault: true`).
- `POST /api/identities` `IdentityInput` → `Identity` (201) ; 20 identités max (sinon 400).
- `PATCH /api/identities/:id` `Partial<IdentityInput>` → `Identity` ; `DELETE /api/identities/:id`
  → 204 (400 pour la dernière identité ; si l'identité par défaut est supprimée, la plus
  ancienne restante devient par défaut). 404 si l'identité n'appartient pas à l'utilisateur.
- `ComposePayload.identityId?: number` : le serveur construit `From: "{name}" <{login}>`,
  ajoute `Reply-To` et le cci de l'identité. Sans `identityId` : identité par défaut.
- La signature de l'identité remplace `Prefs.signatureHtml` (migration : la signature
  existante devient celle de l'identité par défaut).

Interface
- Paramètres → onglet **« Identités »** : liste, bouton **« Ajouter une identité »**, champs
  **« Nom affiché »**, **« Répondre à »**, **« Copie cachée automatique »**, **« Organisation »**,
  **« Signature »** (éditeur riche), case **« Identité par défaut »**, boutons
  **« Enregistrer »** et **« Supprimer l'identité »**.
- Rédaction : si plusieurs identités, sélecteur **« De »** au-dessus de « À » ; changer
  d'identité remplace la signature dans le corps.
- Première connexion : boîte **« Bienvenue »** proposant **« Nom affiché »** puis **« Continuer »**.

### R2.2 Réponses types

API : `GET/POST /api/responses`, `PATCH/DELETE /api/responses/:id` ; `Response { id, name, html }`
(nom ≤ 100 caractères, contenu assaini comme une signature, 100 réponses max).

Interface
- Paramètres → onglet **« Réponses types »** : **« Nouvelle réponse type »**, champs
  **« Nom »** et **« Texte »** (éditeur riche), **« Enregistrer »**, **« Supprimer »**.
- Rédaction : bouton **« Insérer une réponse type »** → liste des réponses ; un clic insère
  le texte à la position du curseur.

### R2.3 Carnet d'adresses complet

Contact : prénom, nom, nom affiché, plusieurs e-mails (libellés *domicile / travail / autre*),
plusieurs téléphones, organisation, fonction, adresse postale, date de naissance, notes.

API
- `GET /api/contacts/:id` → `ContactDetail` ; `PUT /api/contacts/:id` `ContactDetailInput`.
- Groupes : `GET/POST /api/contact-groups`, `PATCH/DELETE /api/contact-groups/:id`,
  `POST /api/contact-groups/:id/members` `{ contactIds }`, `DELETE …/members` `{ contactIds }`.
- Autocomplétion (`GET /api/contacts?q=`) renvoie aussi les groupes :
  `{ contacts: Contact[], groups: { id, name, emails: string[] }[] }` quand `withGroups=1`.
- `GET /api/contacts/export.vcf` (vCard 3.0, tous les contacts) ; `POST /api/contacts/import`
  (multipart, `.vcf` ou `.csv` avec en-têtes `Prénom,Nom,E-mail,Téléphone,Organisation`,
  5 Mo max) → `{ imported: number, skipped: number }` ; doublons (même e-mail) fusionnés.

Interface
- Nouvelle page **« Contacts »** (lien dans la barre latérale, sous les dossiers) : liste avec
  recherche **« Rechercher un contact »**, groupes à gauche (**« Tous les contacts »**,
  **« Adresses collectées »**, puis les groupes), fiche à droite (bureau) ou en page (mobile).
- Boutons **« Nouveau contact »**, **« Modifier »**, **« Supprimer »**, **« Écrire un message »**,
  **« Importer »**, **« Exporter (.vcf) »**, **« Nouveau groupe »**, **« Ajouter au groupe »**.
- Lecture d'un message : bouton **« Ajouter aux contacts »** à côté de l'expéditeur
  (absent s'il y est déjà) ; pièce jointe `.vcf` → bouton **« Importer ce contact »**.
- Rédaction : l'autocomplétion propose les groupes ; choisir un groupe ajoute tous ses membres.

### R2.4 Dossiers

API
- `GET /api/folders?all=1` inclut les dossiers non abonnés (`subscribed: false`).
- `POST /api/folders/subscribe` `{ path, subscribed }` → 204.
- `GET /api/folders/quota` → `{ usedBytes: number, limitBytes: number | null }`.
- `GET /api/folders/size?path=…` → `{ bytes: number, messages: number }`.
- `POST /api/folders` accepte `parent` (sous-dossier) ; `PATCH /api/folders` accepte
  `parent` (déplacer un dossier ; `null` = racine).
- Préférences `specialFolders: { sent, drafts, trash, junk, archive }` (chemins) ; vides =
  détection automatique actuelle.

Interface
- Barre latérale : sous-dossiers indentés et repliables ; en bas, jauge **« Espace utilisé »**
  (« 1,2 Go sur 5 Go »), masquée si le serveur ne fournit pas de quota.
- Menu d'un dossier personnel : **« Nouveau sous-dossier »**, **« Renommer »**,
  **« Déplacer vers… »**, **« Vider le dossier »**, **« Supprimer »**.
- Paramètres → onglet **« Dossiers »** : liste de tous les dossiers avec interrupteur
  **« Afficher »** (abonnement) et taille ; sélecteurs **« Dossier des messages envoyés »**,
  **« Brouillons »**, **« Corbeille »**, **« Spam »**, **« Archives »**.

### R2.5 Volet de lecture et affichage

Préférences (`Prefs`) ajoutées :
- `readingPane: 'none' | 'right'` (défaut `right` à partir de 1024 px ; ignoré en dessous) ;
- `markReadDelay: 0 | 5 | 10 | -1` (secondes ; `-1` = jamais automatiquement) ;
- `preferHtml: boolean` (défaut `true`) ;
- `remoteImages: 'never' | 'contacts' | 'always'` (défaut `never`) ;
- `timeZone: string` (IANA, défaut `Europe/Paris`), `dateFormat: 'relative' | 'short' | 'long'`,
  `timeFormat: '24h' | '12h'` ;
- `replyPosition: 'above' | 'below'` (réponse au-dessus ou en dessous de la citation) ;
- `composeHtml: boolean` (défaut `true` ; `false` = éditeur texte brut) ;
- `logoutEmptyTrash: boolean`, `logoutExpunge: boolean`, `deleteMode: 'trash' | 'permanent'`.

Interface
- Paramètres → **« Général »** : **« Volet de lecture »** (**« À droite »** / **« Aucun »**),
  **« Marquer comme lu »** (**« Immédiatement »**, **« Après 5 s »**, **« Après 10 s »**,
  **« Jamais »**), **« Fuseau horaire »**, **« Format de date »**, **« Format de l'heure »**.
- Onglet **« Affichage »** : **« Afficher le HTML »**, **« Images distantes »**
  (**« Jamais »**, **« Des contacts connus »**, **« Toujours »**).
- Onglet **« Rédaction »** : **« Éditeur »** (**« Mise en forme »** / **« Texte brut »**),
  **« Position de la réponse »** (**« Au-dessus de la citation »** / **« En dessous »**).
- Onglet **« Serveur »** : **« Vider la corbeille à la déconnexion »**,
  **« Compacter la boîte de réception à la déconnexion »**, **« Supprimer définitivement
  au lieu de déplacer vers la corbeille »**.
- Volet de lecture à droite (≥ 1024 px) : la liste reste visible, le message s'ouvre à
  droite ; l'URL change (`/mail/:dossier/:uid`) pour garder l'historique.

### R2.6 Compte et sécurité

- Journal de connexion en SQLite : date, IP (voir `clientIp`), navigateur, succès / échec.
- `GET /api/account/activity` → `{ lastLogin: LoginEvent | null, recent: LoginEvent[] }`
  (20 derniers) ; `GET /api/account/sessions` → sessions actives (sid masqué, date, IP,
  navigateur, `current: boolean`) ; `POST /api/account/sessions/revoke-others` → 204.
- Paramètres → onglet **« Sécurité »** : **« Dernière connexion »** (date, IP, navigateur),
  **« Activité récente »**, **« Sessions actives »**, bouton **« Déconnecter les autres
  sessions »**.
- À la connexion, si la connexion précédente vient d'une autre IP : toast
  **« Dernière connexion le … depuis … »**.
- Inactivité : après `idleMinutes` (préférence, défaut 60), boîte **« Toujours là ? »**
  avec **« Rester connecté »**, puis déconnexion.

### R2.8 Contrat technique complémentaire

Types : `shared/types/mail.ts` section « R2 » (source de vérité). Compléments :

- **Images (ROADMAP R2.1b)** : `signatureHtml` d'une identité et `html` d'une réponse type
  acceptent `<img src="data:image/(png|jpeg|gif);base64,…">` (200 Ko décodés max par image,
  3 images max par signature, 1 Mo max pour le champ). Toute autre `src` est retirée
  (`http:`, `https:`, `cid:`, `data:image/svg+xml`…). À l'envoi (`POST /api/send`), chaque
  image `data:` du HTML devient une partie `multipart/related` avec `Content-ID`, et le HTML
  envoyé référence `cid:…` : **aucun `data:` dans le message envoyé**.
- **Préférences** : `PUT /api/prefs` accepte toutes les clés de `Prefs` (valeurs validées ;
  clé inconnue → 400). `signatureHtml` / `signatureEnabled` restent acceptés (compatibilité) :
  `signatureHtml` est recopié dans l'identité par défaut à sa création.
- **Dossiers** : `GET /api/folders` ne renvoie que les dossiers abonnés (`subscribed: true`) ;
  `?all=1` les renvoie tous. `POST /api/folders { name, parent? }` ;
  `PATCH /api/folders { path, name?, parent? }` (`parent: null` = racine). Un sous-dossier a
  pour chemin `{parent}{delimiter}{name}`.
- **Lecture** : `MessageDetail.listPost` (adresse de `List-Post`, sans `mailto:`) et
  `MessageDetail.senderInContacts`.
- **Suppression** : avec `deleteMode: 'permanent'`, « Supprimer » efface définitivement
  (confirmation **« Supprimer définitivement ? »**) au lieu de déplacer vers la Corbeille.
- **Déconnexion** (`POST /api/auth/logout`) : applique `logoutEmptyTrash` et `logoutExpunge`
  avant de fermer la session.
- **Fiche contact** (`PUT /api/contacts/:id` remplace la fiche entière, tous les champs sont
  requis) : `firstName`, `lastName`, `displayName`, `emails: { label: 'home' | 'work' |
  'other', address }[]` (au moins une ; la première est l'adresse principale),
  `phones: { label: 'home' | 'work' | 'mobile' | 'other', number }[]`, `organization`,
  `jobTitle`, `address: { street, postalCode, city, country } | null`,
  `birthday: 'AAAA-MM-JJ' | null`, `notes`. Libellés affichés : « Domicile », « Travail »,
  « Mobile », « Autre ».
- **`POST /api/__mock/reset`** (backend mémoire uniquement) remet **tout** à l'état initial :
  messages, filtres, et toutes les données locales (préférences, identités, réponses types,
  contacts, groupes, journal de connexion, double authentification).
- **Insérer une image** (éditeur) : le bouton ouvre le sélecteur de fichier, puis la boîte
  **« Insérer une image »** avec **« Texte alternatif »**, la largeur (**« Petite »**,
  **« Moyenne »**, **« Originale »**) et les boutons **« Annuler »** / **« Insérer »**.
- **Dates** : en format « relatif », seule une date du jour affiche l'heure ; la date
  complète en tête d'un message ouvert affiche toujours l'heure (au format choisi).
- **Libellés complémentaires** : bouton du menu de sélection **« Options de sélection »** ;
  suppression d'une identité confirmée par la boîte **« Supprimer cette identité ? »**
  (bouton **« Supprimer l'identité »**) ; chaque section des paramètres a un titre (h2)
  identique à son onglet ; la liste des contacts est une liste nommée **« Contacts »** ;
  l'onglet Dossiers est un tableau (une ligne par dossier, interrupteur « Afficher {nom} »).
- **Sous-dossiers** : dépliés par défaut ; bouton **« Réduire {nom} »** / **« Développer {nom} »**
  sur un dossier qui a des sous-dossiers. Paramètres : sections `?tab=general`, `identities`,
  `responses`, `display`, `compose`, `folders`, `server`, `security`, `contacts`
  (`?tab=signature` ouvre `identities`).
- **Groupes dans l'autocomplétion** : un groupe apparaît sous la forme
  **« {nom du groupe} ({n} membres) »** ; le choisir ajoute une puce par membre.
- **Sessions** : `ActiveSession.id` est une empreinte (8 caractères hexadécimaux), jamais le
  sid ; `DELETE /api/account/sessions/:id` déconnecte une session précise.

Données de test R2 (backend mémoire, compte `dev@mmi-troyes.fr`) :
**« Liste MMI : réunion de rentrée »** (en-tête `List-Post: <mailto:liste-mmi@mmi-troyes.fr>`),
**« Carte de visite de Léa »** (pièce jointe `lea-dubois.vcf` : Léa Dubois, travail
`lea.dubois@mmi-troyes.fr`, mobile `+33 6 12 34 56 78`, IUT de Troyes, Enseignante),
sous-dossier **« 2026 »** de « Projets » (chemin `INBOX.Projets.2026`, message
**« Projet 2026 — cahier des charges »**), dossier **non abonné** **« Anciens cours »**
(message « Archives du semestre 1 »). Quota du backend mémoire : 1 Gio. La boîte de
réception contient désormais **72** messages.

## Vague R3 — langue (FR / EN) et aide

Internationalisation complète de l'interface et page d'aide.
