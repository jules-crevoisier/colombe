# Plan v4 : manques relevés dans la documentation Roundcube, et filtres

Source des manques : [AUDIT-ROUNDCUBE-DOC.md](AUDIT-ROUNDCUBE-DOC.md), section B (les
numéros `#n` y renvoient). Les libellés entre « » sont **contractuels** : les tests
d'acceptation sont écrits à partir d'eux, sans lire le code.

Toutes les nouvelles préférences s'ajoutent à `Prefs` (`shared/types/mail.ts`) et passent
par `PUT /api/prefs` (valeur invalide → 400).

---

## R4 — compléments Roundcube

### R4.1 Liste et lecture

| # | Fonction | Contrat |
|---|---|---|
| 1, 41 | Actualisation | `refreshMinutes: 0 \| 1 \| 3 \| 5 \| 10 \| 30 \| 60` (défaut 5) : **« Actualiser la liste »** (**« Jamais »**, **« Toutes les minutes »**, **« Toutes les 3 min »**, **« Toutes les 5 min »**, **« Toutes les 10 min »**, **« Toutes les 30 min »**, **« Toutes les heures »**). `checkAllFolders: boolean` (défaut `false`) : **« Vérifier les nouveaux messages dans tous les dossiers »** (compteurs de non-lus de tous les dossiers mis à jour à chaque actualisation, en plus du direct sur la boîte de réception). |
| 2 | Nouvelle fenêtre | Lecture → « Plus d'actions » → **« Ouvrir dans une nouvelle fenêtre »** : ouvre `/mail/{dossier}/{uid}?standalone=1` dans un nouvel onglet, sans barre latérale. La rédaction reste dans la fenêtre principale (voir « Hors périmètre »). |
| 3 | Fils dans la liste | Voir R4.6. |
| 5 | Compacter | Menu d'un dossier : **« Compacter »** → `POST /api/folders/compact { path }` (supprime définitivement les messages marqués `\Deleted`) → toast **« Dossier compacté »**. |
| 6 | Chercher un dossier | Paramètres → Dossiers : champ **« Rechercher un dossier »** qui filtre la liste. |
| 7, 34 | Photos | Voir R4.3 ; en lecture, l'avatar de l'expéditeur affiche sa photo si le contact en a une. |
| 8 | Précédent / suivant | En lecture : boutons **« Message précédent »** et **« Message suivant »** (et touches `k` / `j`), selon le tri courant. `GET /api/messages/{uid}/neighbors?folder=…&sort=…&order=…` → `{ prev: number \| null, next: number \| null }`. |
| 9 | Miniatures | `attachmentThumbnails: boolean` (défaut `true`) : **« Afficher les miniatures des images jointes »** ; les images jointes (png, jpeg, gif, webp) apparaissent en miniatures sous le message, un clic ouvre **« Aperçu : {nom} »** (R1.3). Chargées en `Blob`, jamais par URL directe dans le corps. |
| 10 | Seuil des citations | `quoteCollapseLines: 0 \| 5 \| 10 \| 20` (défaut 0 = toujours replier) : **« Replier les citations »** (**« Toujours »**, **« De plus de 5 lignes »**, **« De plus de 10 lignes »**, **« De plus de 20 lignes »**). |
| 11 | Archivage | `archiveType: 'single' \| 'year' \| 'month' \| 'sender' \| 'folder'` : **« Classer les archives »** (**« Dans un seul dossier »**, **« Par année »**, **« Par mois »**, **« Par expéditeur »**, **« Par dossier d'origine »**) ; `archiveMarkRead: boolean` : **« Marquer comme lu à l'archivage »**. `POST /api/messages/archive { folder, uids }` → `{ moved: number }` ; le serveur crée les sous-dossiers `Archives/2026`, `Archives/2026/09`, `Archives/{adresse de l'expéditeur}` ou `Archives/{nom du dossier d'origine}`. Le bouton « Archiver » existant utilise cette route. |
| 12 | Mbox | `POST /api/messages/import` accepte aussi un fichier `.mbox` (séparateurs `From ` en début de ligne, `>From ` déséchappé) ; mêmes limites (25 Mo au total). |
| 13 | Noms réels | `showRealFolderNames: boolean` (défaut `false`) : **« Afficher les noms réels des dossiers spéciaux »** (ex. `Sent` au lieu de « Envoyés »). |
| 14 | Abonnements | `useSubscriptions: boolean` (défaut `true`) : **« N'afficher que les dossiers abonnés »** ; désactivé = tous les dossiers dans la barre latérale. |
| 15 | Redimensionner | Entre la liste et le volet de lecture (≥ 1024 px) : séparateur `role="separator"` nommé **« Redimensionner le volet de lecture »**, déplaçable à la souris et aux flèches du clavier ; `readingPaneWidth: number` (pourcentage de la largeur de la liste, 30 à 70, défaut 40). |

### R4.2 Rédaction

| # | Fonction | Contrat |
|---|---|---|
| 16 | Copie de l'envoi | « Options d'envoi » → groupe **« Enregistrer une copie dans »** : un élément radio par dossier (défaut : Envoyés) + **« Ne pas enregistrer »**. `ComposePayload.saveSentTo?: string \| null` (`null` = ne pas enregistrer ; absent = dossier Envoyés). |
| 17 | Transfert par défaut | `forwardMode: 'inline' \| 'attachment'` : **« Transférer les messages »** (**« Dans le corps du message »**, **« En pièce jointe »**) ; le bouton « Transférer » suit ce choix. |
| 18 | Mode de l'éditeur | `htmlEditorMode: 'never' \| 'reply' \| 'forward' \| 'always' \| 'always-except-plain'` remplace `composeHtml` (migration : `true` → `always`, `false` → `never`) : **« Éditeur HTML »** (**« Jamais »**, **« Pour répondre à un message HTML »**, **« Pour répondre à un message HTML ou le transférer »**, **« Toujours »**, **« Toujours, sauf en réponse à un message texte »**). |
| 19 | Brouillons | `draftAutosaveSeconds: 0 \| 30 \| 60 \| 180 \| 300 \| 600` (défaut 60) : **« Enregistrer les brouillons »** (**« Jamais »**, **« Toutes les 30 s »**, **« Toutes les minutes »**, **« Toutes les 3 min »**, **« Toutes les 5 min »**, **« Toutes les 10 min »**). L'enregistrement à la fermeture reste systématique. |
| 21 | Réponse sans citation | `replyPosition` accepte `'none'` : **« Ne pas citer le message d'origine »**. Lecture → « Plus d'actions » → **« Répondre sans citer »**. |
| 22 | Accusés par défaut | `alwaysRequestReadReceipt`, `alwaysRequestDeliveryReceipt` : **« Toujours demander un accusé de lecture »**, **« Toujours demander un accusé de remise »** (cases pré-cochées dans « Options d'envoi »). |
| 23 | Accusés demandés | `mdnBehavior: 'ask' \| 'send' \| 'send-contacts' \| 'ignore'` (défaut `ask`) : **« Quand un expéditeur demande un accusé de lecture »** (**« Me demander »**, **« L'envoyer automatiquement »**, **« L'envoyer automatiquement à mes contacts, sinon me demander »**, **« Ne jamais l'envoyer »**). « Ne jamais » masque le bandeau. |
| 24 | Listes | `replyAllMode: 'all' \| 'list'` : **« « Répondre à tous » sur une liste de diffusion »** (**« Répond à tous les destinataires »**, **« Répond à la liste seulement »**). |
| 25 | Signature | Remplace `signatureEnabled` : `signatureInsert: 'always' \| 'new' \| 'reply-forward' \| 'never'` (**« Ajouter la signature »** : **« Toujours »**, **« Aux nouveaux messages »**, **« Aux réponses et transferts »**, **« Jamais »**) ; `signatureBelowQuote: boolean` (**« Placer la signature sous la citation »**) ; `stripSignatureOnReply: boolean` (**« Retirer la signature du message cité »** : tout ce qui suit une ligne `-- ` est retiré de la citation) ; `signatureSeparator: boolean` (défaut `true`, **« Précéder la signature de « -- » »**). |
| 26 | Police | `defaultFont: 'sans' \| 'serif' \| 'mono'` (**« Police par défaut »** : **« Sans empattement »**, **« Avec empattement »**, **« Chasse fixe »**) et `defaultFontSize: 12 \| 14 \| 16 \| 18` (**« Taille par défaut »**). Polices système uniquement (aucune police externe) ; appliquées dans l'éditeur et au HTML envoyé. |
| 28 | Adresse | `showEmailAddress: boolean` : **« Afficher l'adresse e-mail plutôt que le nom »** (liste et lecture). |
| 30 | Expéditeurs de confiance | `remoteImages` accepte `'trusted'` : **« De mes expéditeurs de confiance »** (en plus de « Jamais », « Des contacts connus », « Toujours »). Bandeau des images distantes : bouton **« Toujours afficher pour cet expéditeur »** → ajoute l'adresse. Paramètres → Affichage : liste **« Expéditeurs de confiance »** avec **« Retirer »**. API `GET /api/trusted-senders` → `string[]`, `POST { address }`, `DELETE { address }` ; 500 adresses max. `MessageDetail.senderTrusted: boolean`. |

### R4.3 Carnet d'adresses

| # | Fonction | Contrat |
|---|---|---|
| 32 | Recherche | À côté de « Rechercher un contact » : **« Chercher dans »** (**« Nom »**, **« E-mail »**, **« Tous les champs »**) ; bouton **« Recherche avancée »** → boîte avec **« Nom »**, **« E-mail »**, **« Téléphone »**, **« Organisation »**, **« Notes »** (toutes les conditions doivent être vraies). `GET /api/contacts?q=…&field=name\|email\|all` et `GET /api/contacts/search?name=…&email=…&phone=…&organization=…&notes=…`. |
| 33 | Recherches enregistrées | **« Enregistrer la recherche »** (nom demandé) ; elles apparaissent sous les groupes, avec **« Supprimer la recherche »**. API `GET/POST /api/contact-searches`, `DELETE /api/contact-searches/{id}`. |
| 34 | Photo | Fiche : **« Ajouter une photo »**, **« Remplacer la photo »**, **« Supprimer la photo »**. PNG ou JPEG, 200 Ko max, vérifiés par leur signature binaire (pas seulement l'extension). `PUT /api/contacts/{id}/photo` (multipart), `DELETE`, `GET` (servie avec `X-Content-Type-Options: nosniff`, jamais de SVG). `Contact.hasPhoto: boolean`. |
| 35 | Import | Boîte d'import : case **« Remplacer tout le carnet d'adresses »** → confirmation **« Remplacer le carnet ? »**. `POST /api/contacts/import` avec champ `replace=1`. |
| 36 | Affichage | `contactNameFormat: 'display' \| 'first-last' \| 'last-first' \| 'last-comma-first'` (**« Afficher les noms »** : **« Nom affiché »**, **« Prénom Nom »**, **« Nom Prénom »**, **« Nom, Prénom »**) ; `contactSort: 'display' \| 'first' \| 'last'` (**« Trier les contacts par »** : **« Nom affiché »**, **« Prénom »**, **« Nom »**). |
| 37 | Pagination | `contactsPageSize: 25 \| 50 \| 100` : **« Contacts par page »**. |

### R4.4 Suppression et serveur

| # | Fonction | Contrat |
|---|---|---|
| 39 | Modes de suppression | `deleteMode` accepte `'flag'` : **« Marquer pour suppression »** (drapeau `\Deleted`, le message reste en place, barré, avec **« Restaurer »**). `hideDeleted: boolean` : **« Masquer les messages marqués pour suppression »**. `markReadOnDelete: boolean` : **« Marquer comme lu en supprimant »**. `deleteJunkDirectly: boolean` : **« Supprimer définitivement les messages du Spam »**. Paramètres → Serveur : **« Quand je supprime un message »** (**« Le déplacer vers la Corbeille »**, **« Le supprimer définitivement »**, **« Le marquer pour suppression »**). |
| 40 | Purge | `logoutPurgeDays: 0 \| 30 \| 60 \| 90` : **« À la déconnexion, supprimer de la Corbeille les messages de plus de »** (**« Désactivé »**, **« 30 jours »**, **« 60 jours »**, **« 90 jours »**). |

### R4.5 Divers

| # | Fonction | Contrat |
|---|---|---|
| 42 | Liens mailto: | Paramètres → Général : bouton **« Ouvrir les liens mailto: avec Colombe »** (`navigator.registerProtocolHandler`). La route `/compose?to=mailto:…` ouvre la rédaction préremplie (`to`, `cc`, `bcc`, `subject`, `body`). |
| 43 | Compte | Paramètres → Sécurité → **« Informations du compte »** : **« Identifiant »** (adresse de connexion), **« Première connexion à Colombe »** (date), **« Dernière connexion »**. `AccountActivity.firstLogin: string \| null`. |
| 44 | Reconnexion | Côté serveur : une opération IMAP **en lecture** (liste, lecture, recherche, drapeaux) qui échoue sur une erreur réseau passagère (`ECONNRESET`, délai dépassé, `BYE`) est retentée 2 fois (200 ms puis 1 s) avec une nouvelle connexion. Jamais pour l'envoi ni l'ajout d'un message. |

### R4.6 Liste regroupée par conversation (reportée de R2.7)

- `threadList: boolean` (existe déjà) : **« Regrouper par conversation »** (Paramètres → Affichage).
- `threadExpand: 'never' \| 'always' \| 'unread'` : **« Développer les conversations »** (**« Jamais »**, **« Toujours »**, **« Seulement celles qui ont des non-lus »**).
- `GET /api/messages?threads=1` → `MessagePage` dont chaque élément est le dernier message d'un fil, avec `threadSize: number` et `threadUnread: number` (champs optionnels de `MessageSummary`). Serveur : commande IMAP `THREAD=REFERENCES` si annoncée, sinon regroupement par `Message-ID` / `References` / objet normalisé.
- Une ligne de fil affiche le nombre de messages ; **« Développer la conversation »** / **« Réduire la conversation »** affiche les messages du fil en retrait.

### Hors périmètre, avec la raison

| # | Fonction | Raison |
|---|---|---|
| 2 (partie) | Rédaction dans une fenêtre séparée | La rédaction est une fenêtre flottante déjà détachable (plein écran, réduite) ; une seconde fenêtre navigateur dupliquerait l'état du brouillon. |
| 4 | Colonnes de la liste | Absent du thème par défaut de Roundcube 1.6 (Elastic), propre à l'ancien thème Larry. |
| 20 | Copie du brouillon dans le navigateur | Postes partagés à l'IUT : un brouillon laissé dans le stockage local serait lisible par l'utilisateur suivant. L'enregistrement serveur (R4.2 #19) suffit. |
| 27 | Jeu de caractères | Tout est envoyé en UTF-8 et chaque message reçu est décodé selon son propre jeu de caractères. |
| 29 | Options du correcteur | Le correcteur est celui du navigateur ; ces réglages s'y font. |
| 31 | Options MIME | Messages toujours conformes (RFC 2047/2231, UTF-8) : pas de réglage à exposer. |
| 38 | Formulaire perso / pro | La fiche contact montre déjà tous les champs. |
| 42 (partie) | Fenêtres « standard » | Propre à l'interface de Roundcube (fenêtres internes) ; Colombe utilise déjà des boîtes de dialogue accessibles. |

---

## F — Filtres, réponse automatique, transfert (Sieve)

Pourquoi côté serveur, prérequis admin et règles de sécurité : voir [ROADMAP.md](ROADMAP.md)
section F. Ce qui suit est le contrat.

### Configuration

- `MAIL_SIEVE_HOST` (défaut : `MAIL_HOST`), `MAIL_SIEVE_PORT` (défaut 4190),
  STARTTLS obligatoire sauf sur `127.0.0.1`/`localhost`.
- `MAIL_FORWARD_DOMAINS` (défaut `mmi-troyes.fr`) : domaines autorisés pour tout
  transfert ou redirection, y compris dans un script modifié à la main.
- Backend mémoire : un faux serveur ManageSieve en mémoire (capacités `fileinto`,
  `vacation`, `copy`, `imap4flags`, `date`, `relational`, `body`, `reject`, `editheader`,
  `variables`, `enotify`) pour l'interface et les tests.

### Types (à ajouter à `shared/types/mail.ts`)

```ts
type FilterField = 'from' | 'to-cc' | 'subject' | 'size' | 'header' | 'body' | 'date' | 'spam'
type FilterOp = 'contains' | 'not-contains' | 'is' | 'is-not' | 'starts-with' | 'matches'
  | 'over' | 'under' | 'count-over' | 'value-over' | 'before' | 'after'
interface FilterCondition {
  field: FilterField
  header?: string                            // si field = 'header'
  addressPart?: 'all' | 'localpart' | 'domain' // champs d'adresse
  op: FilterOp
  value: string                               // taille en Ko pour 'size', AAAA-MM-JJ pour 'date'
  caseSensitive?: boolean
}
type FilterAction =
  | { type: 'move' | 'copy'; folder: string }
  | { type: 'mark-read' | 'flag' | 'delete' | 'stop' }
  | { type: 'add-flag'; flag: string }
  | { type: 'redirect'; address: string; keepCopy: boolean }
  | { type: 'reject'; message: string }
  | { type: 'add-header'; name: string; value: string }
  | { type: 'notify'; address: string; message: string }
interface FilterRule {
  id: string
  name: string
  enabled: boolean
  match: 'all' | 'any'
  conditions: FilterCondition[]   // vide = tous les messages
  actions: FilterAction[]         // au moins une
}
interface FilterSetSummary { name: string; active: boolean; managed: boolean }
interface FilterSet { name: string; active: boolean; managed: boolean; rules: FilterRule[]; script: string }
interface VacationSettings {
  enabled: boolean
  from: string | null; until: string | null   // AAAA-MM-JJ
  subject: string; message: string            // texte brut
  days: number                                // 1 à 30
  addresses: string[]                         // adresses supplémentaires reconnues
  replyFrom: string                           // toujours l'adresse de connexion
  incoming: 'keep' | 'discard' | 'redirect' | 'copy'
  incomingAddress: string | null
}
interface ForwardSettings { enabled: boolean; address: string; keepCopy: boolean }
interface FiltersStatus { available: boolean; capabilities: string[]; sets: FilterSetSummary[] }
```

### API

- `GET /api/filters` → `FiltersStatus` (`available: false` si ManageSieve est injoignable :
  l'interface affiche **« Les filtres ne sont pas disponibles sur ce serveur. »**).
- Ensembles (#45) : `POST /api/filters/sets { name, copyFrom? }`,
  `GET /api/filters/sets/{name}` → `FilterSet`, `PUT /api/filters/sets/{name} { rules }`,
  `PUT /api/filters/sets/{name}/script { script }` (#46, l'ensemble devient `managed: false`),
  `POST /api/filters/sets/{name}/activate`, `POST /api/filters/deactivate`,
  `DELETE /api/filters/sets/{name}` (pas l'ensemble actif → 409),
  `GET /api/filters/sets/{name}/export` (`.sieve`, en pièce jointe),
  `POST /api/filters/import` (multipart `.sieve`, nom = nom du fichier).
- Réponse automatique et transfert : `GET/PUT /api/filters/vacation` (`VacationSettings`),
  `GET/PUT /api/filters/forward` (`ForwardSettings`). Ils sont écrits dans l'ensemble
  actif (créé sous le nom `colombe` s'il n'y en a pas).
- Un ensemble géré par Colombe garde ses règles en JSON dans un commentaire d'en-tête ;
  le script est **généré** depuis ces règles. Un ensemble modifié à la main (`managed:
  false`) ne s'édite plus qu'en mode script.
- Tout script est validé par `CHECKSCRIPT` avant `PUTSCRIPT` ; erreur → 400 avec le message
  du serveur.
- Codes : création d'un ensemble et import → 201 (`FilterSet`) ; `PUT` → 200 (objet
  enregistré) ; activer, désactiver, supprimer → 204. Import : nom de l'ensemble = nom du
  fichier sans `.sieve`.
- Configuration à l'exécution (serveur compilé) : `NUXT_MAIL_SIEVE_HOST`,
  `NUXT_MAIL_SIEVE_PORT`, `NUXT_MAIL_FORWARD_DOMAINS`, `NUXT_MAIL_TLS_REJECT_UNAUTHORIZED`
  (clés `runtimeConfig.mail.sieveHost`, `sievePort`, `forwardDomains`, `tlsRejectUnauthorized`).

### Sécurité (non négociable)

- `redirect`, `notify`, le transfert et `vacation.incoming = redirect | copy` : adresse
  obligatoirement dans `MAIL_FORWARD_DOMAINS`, sinon 400
  **« Transfert interdit vers ce domaine. »**. Pour un script écrit à la main, le serveur
  analyse le script (lexique Sieve : chaînes, `text:`, commentaires) et refuse toute
  commande `redirect` / `notify` / `vacation :from` hors règles.
- Créer ou modifier une redirection, une notification ou un transfert, ou enregistrer un
  script à la main, exige `confirmPassword` (ou `totpCode` si la double authentification
  est active) dans le corps de la requête ; sinon 403 **« Confirmez votre mot de passe. »**.
- Après un tel changement : un e-mail **« Colombe : transfert modifié sur votre
  compte »** est envoyé à l'adresse de connexion, et l'événement apparaît dans
  « Activité récente ».
- `reject` : message limité à 500 caractères.

### Interface

- Paramètres → onglet **« Filtres »** : sélecteur **« Ensemble de filtres »** avec
  **« Nouvel ensemble »**, **« Activer »**, **« Supprimer l'ensemble »**, **« Exporter »**,
  **« Importer »**, **« Modifier le script »** (éditeur texte, **« Enregistrer le script »**).
  Liste des filtres avec interrupteur **« Actif »**, **« Monter »**, **« Descendre »**
  (et glisser-déposer), **« Nouveau filtre »**.
- Boîte **« Nouveau filtre »** / **« Modifier le filtre »** : **« Nom du filtre »**,
  **« Pour les messages qui correspondent à »** (**« Toutes les règles suivantes »**,
  **« Au moins une des règles suivantes »**, **« Tous les messages »**), lignes de
  conditions (**« Ajouter une condition »**), lignes d'actions (**« Ajouter une action »**),
  **« Enregistrer »**. Libellés des champs : **« De »**, **« À ou Cc »**, **« Objet »**,
  **« Taille »**, **« En-tête… »**, **« Corps du message »**, **« Date de réception »**,
  **« Niveau de spam »** ; des opérateurs : **« contient »**, **« ne contient pas »**,
  **« est »**, **« n'est pas »**, **« commence par »**, **« correspond à »**,
  **« plus grand que »**, **« plus petit que »**, **« avant le »**, **« après le »** ;
  des actions : **« Déplacer vers »**, **« Copier vers »**, **« Marquer comme lu »**,
  **« Suivre »**, **« Ajouter le mot-clé »**, **« Rediriger vers »**, **« Rejeter avec le
  message »**, **« Ajouter l'en-tête »**, **« M'avertir à »**, **« Supprimer »**,
  **« Arrêter les filtres suivants »**. Une condition ou action non prise en charge par le
  serveur (capacités) n'est pas proposée.
- Onglet **« Réponse automatique »** : **« Activer la réponse automatique »**, **« Du »**,
  **« Au »**, **« Objet »**, **« Message »**, **« Ne pas répondre plus d'une fois tous les »**
  (jours), **« Mes autres adresses »**, **« Message reçu »** (**« Le garder »**,
  **« Le supprimer »**, **« Le rediriger vers »**, **« En envoyer une copie à »**),
  **« Enregistrer »**.
- Onglet **« Transfert »** : **« Transférer tous mes messages à »**, **« Garder une copie »**,
  **« Enregistrer »**.
- Toute action de sécurité ci-dessus ouvre **« Confirmez votre identité »** avec
  **« Mot de passe »** (ou **« Code de vérification »**) et **« Confirmer »**.
- Lecture → « Plus d'actions » → **« Créer un filtre… »** : boîte « Nouveau filtre »
  préremplie (De = expéditeur, Objet = objet).

### Tests

- API (testeur aveugle) contre le faux serveur ManageSieve.
- Intégration contre un conteneur Dovecot avec Pigeonhole (`docker compose`) : créer un
  filtre « Objet contient [MMI] → Projets », envoyer un message par SMTP, **vérifier qu'il
  est livré dans Projets** ; réponse automatique reçue par l'expéditeur ; redirection vers
  un domaine interdit refusée.
