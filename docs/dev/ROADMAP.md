# Feuille de route : remplacer Roundcube pour tous les comptes

État au 18 septembre 2026. Détail fonction par fonction : [AUDIT-ROUNDCUBE.md](AUDIT-ROUNDCUBE.md).
Contrats détaillés des vagues R2 et R3 : [PLAN-v3.md](PLAN-v3.md).

## Où on en est

| | Avant R1 | Après R1 |
|---|---|---|
| ✅ Fonctions Roundcube présentes | 21 | **45** |
| 🟡 Partielles | 7 | 7 |
| ❌ Manquantes | 42 | **18** + filtres |
| Au-delà de Roundcube | double authentification, annuler l'envoi, mails en direct, conversations | + sessions actives (R2) |

À noter : le Roundcube de l'IUT n'a **pas non plus** de filtres aujourd'hui (plugins
installés : `archive`, `zipdownload`, `attachment_reminder`, `newmail_notifier`, `password`).
Les filtres seront donc un gain pour les utilisateurs, pas seulement une parité.

## Ordre proposé

| Vague | Contenu | Taille | Dépend de |
|---|---|---|---|
| **R1** (fin) | Tests E2E, API, commit | S | — |
| **R2** | Identités **+ images dans la signature et la rédaction**, réponses types, carnet complet, dossiers, volet de lecture, réglages, sécurité du compte, menu de sélection, réponse à la liste | L | R1 |
| **F** | **Filtres**, réponse automatique, transfert (Sieve) | M | conteneur Dovecot (dev) ; feu vert admin (prod) |
| **R4** | 42 manques relevés dans la documentation Roundcube ([PLAN-v4.md](PLAN-v4.md)) : actualisation, précédent/suivant, miniatures, archivage par date, mbox, options de signature, mode de l'éditeur, expéditeurs de confiance, photos et recherches de contacts, modes de suppression, liste en fils… | L | R2 |
| **R3** | Interface FR / EN, page d'aide | M | R2, R4 |
| **P** | Mise en production, migration depuis Roundcube, pilote puis bascule | M | R2, F si validé |

F peut démarrer en parallèle de R2 : ce sont des fichiers différents (onglet de paramètres,
client ManageSieve).

### Décisions du 19 septembre 2026

| Vague | Décision | Ce qu'il faut |
|---|---|---|
| **A** — Connexion CAS | **CAS de l'URCA via OpenID Connect**, avec un jeton vérifié par Dovecot (`passdb oauth2`, introspection) : ni mot de passe stocké, ni « utilisateur maître » capable d'ouvrir les 348 boîtes. La connexion par mot de passe (+ double authentification) reste disponible pendant la transition. Le code est préparé sans être activé. | DSI URCA : le CAS parle-t-il OIDC ? URL de l'émetteur, enregistrement d'un client, point d'introspection. Table de correspondance identifiant URCA → adresse `@mmi-troyes.fr`. Réglage Dovecot sur le serveur (feu vert admin). |
| **L** — Annuaire LDAP | **Annuaire global en lecture seule** (comme le carnet LDAP de Roundcube) : autocomplétion et section **« Annuaire »** de la page Contacts. L'authentification reste sur Dovecot. | Adresse du serveur LDAP (URCA ou IUT), base de recherche, compte de lecture, attributs (nom, e-mail, service, téléphone). |
| **G** — Autres appareils | Page **« Configurer un autre appareil »** : réglages IMAP/SMTP, QR code, profil iPhone/iPad (`.mobileconfig`, sans mot de passe), configuration automatique Thunderbird (`autoconfig`) et Outlook (`autodiscover`), pas-à-pas pour l'application Gmail (Android/iOS). Gmail web ne relève plus les comptes externes depuis 2026 ; le transfert vers Gmail reste bloqué par défaut (règle anti-exfiltration, F). | Pour la configuration automatique : enregistrements DNS `autoconfig.mmi-troyes.fr` / `autodiscover.mmi-troyes.fr` (admin). |
| **Nom** | **Colombe** (retenu le 19/09 parmi Colombe, Colombe, Vélin, Hirondelle ; aucun produit de messagerie ni projet libre à ce nom, nom npm libre). Renommage de l'interface, du paquet et de la documentation après la vague R2. | Renommage du dépôt GitHub (avec accord). |

---

## R2 — compléments au contrat de PLAN-v3

### R2.1b Images dans la signature et dans les messages

Roundcube le permet (éditeur HTML) ; c'est attendu pour un logo ou une signature
institutionnelle.

- Éditeur riche (signature d'identité, réponses types, rédaction) : bouton **« Insérer une
  image »**, coller ou glisser une image. Formats **PNG, JPEG, GIF** ; 200 Ko max par image ;
  signature : 3 images max. Champ **« Texte alternatif »** (accessibilité), largeur
  **« Petite »** / **« Moyenne »** / **« Originale »**.
- Stockage : l'image est gardée en `data:image/…;base64` dans le HTML de la signature (SQLite).
- **Jamais d'URL distante** : une `<img src="https://…">` dans une signature serait un
  pixel de traçage chez chaque destinataire, et contredit la règle « aucune ressource
  externe ». L'assainissement sortant n'accepte que `data:image/(png|jpeg|gif)`.
- À l'envoi, le serveur convertit chaque image `data:` en pièce jointe intégrée
  (`multipart/related`, `Content-ID`, `src="cid:…"`), ce qui fonctionne dans Outlook et Gmail
  alors que les `data:` y sont souvent bloquées. Conversion faite par nous (analyse de
  l'URI `data:`) : on ne passe jamais d'URL à nodemailer, qui irait la télécharger (SSRF).
- Brouillons : les images restent en `data:` ; la conversion n'a lieu qu'à l'envoi.

### R2.7 Liste : fils, sélection, liste de diffusion

- ~~Préférence « Regrouper par conversation »~~ : **reportée en R4** (nécessite la commande
  IMAP `THREAD`, absente de GreenMail ; à développer contre le conteneur Dovecot). La
  préférence `threadList` existe déjà dans le contrat mais n'est pas encore affichée.
- Menu de sélection à côté de la case **« Tout sélectionner »** : **« Tous »**, **« Aucun »**,
  **« Non lus »**, **« Suivis »**, **« Inverser la sélection »**.
- Message d'une liste de diffusion (en-tête `List-Post`) : bouton **« Répondre à la liste »**.

---

## F — Filtres, réponse automatique, transfert

### Pourquoi c'est bloqué côté serveur, et ce qu'il faut à l'admin

Les filtres doivent tourner **sur le serveur**, à la livraison, même quand personne n'est
connecté. Le standard est **Sieve**, géré à distance par le protocole **ManageSieve**
(RFC 5804), comme le plugin `managesieve` de Roundcube. Sur le serveur de l'IUT :

1. installer `dovecot-sieve` et `dovecot-managesieved` ;
2. activer le plugin `sieve` pour LMTP/LDA, **et vérifier que Postfix livre bien via Dovecot**
   (LMTP ou LDA). Sinon Sieve ne s'exécute jamais ;
3. ManageSieve en écoute sur **127.0.0.1:4190** seulement (Colombe est sur la même
   machine) : le port n'est pas ouvert sur Internet.

En développement : un conteneur Dovecot 2.4.1 avec Pigeonhole (`docker compose up -d
dovecot`), à côté de GreenMail. Il servira aussi à tester le backend IMAP contre le vrai
logiciel de production. Contrat détaillé (types, API, libellés) : [PLAN-v4.md](PLAN-v4.md)
section F.

### Fonctions

- **Filtres** : nom, actif / inactif, **« Toutes les conditions »** / **« Au moins une »**.
  - Conditions : **De**, **À ou Cc**, **Objet**, **Taille** (plus de / moins de), **En-tête**
    (nom libre) ; opérateurs **contient**, **ne contient pas**, **est**, **n'est pas**,
    **commence par**.
  - Actions : **déplacer vers** (dossier), **copier vers**, **marquer comme lu**,
    **suivre**, **transférer à** (voir sécurité), **supprimer**, **arrêter les filtres
    suivants**.
  - Ordre modifiable par glisser-déposer **et** par boutons **« Monter »** / **« Descendre »**
    (clavier).
- **Réponse automatique** : active, du … au …, objet, message, pas plus d'une réponse par
  expéditeur tous les **N jours** (défaut 7). Jamais de réponse aux listes ni aux robots
  (comportement natif de `vacation`).
- **Transfert** : transférer tous les messages à une adresse, en gardant ou non une copie.
- Lecture d'un message : **« Créer un filtre… »**, prérempli avec l'expéditeur et l'objet.

### Technique

- Client ManageSieve maison (STARTTLS, `AUTHENTICATE PLAIN`, `LISTSCRIPTS`, `GETSCRIPT`,
  `PUTSCRIPT`, `CHECKSCRIPT`, `SETACTIVE`), petit et testable, comme le TOTP. Identifiants
  pris dans le même stockage serveur que l'IMAP : rien ne passe par le navigateur.
- Un script `colombe` géré par l'application : les règles sont en JSON (en commentaire
  d'en-tête) et le script Sieve en est **généré**. Un script écrit à la main (option avancée, PLAN-v4)
  n'est analysé que pour y refuser les redirections hors domaines autorisés.
- Si l'utilisateur a déjà un autre script actif : avertissement, puis remplacement avec
  sauvegarde (`colombe-sauvegarde-AAAA-MM-JJ`).
- Les fonctions sont affichées selon les capacités annoncées par le serveur (`fileinto`,
  `vacation`, `copy`, `imap4flags`, `date`).

### Sécurité : leçon de l'incident

Avec des identifiants volés, **une règle de transfert discrète est la première chose
qu'un attaquant installe** : elle continue d'exfiltrer le courrier même après le
changement de mot de passe. D'où :

- transfert autorisé **uniquement vers les domaines de la liste**
  `MAIL_FORWARD_DOMAINS` (défaut : `mmi-troyes.fr`) ;
- créer ou modifier un transfert demande de **confirmer son mot de passe** (ou le code de
  double authentification si elle est active) ;
- chaque changement de transfert envoie un **e-mail d'alerte** au titulaire du compte et
  est inscrit dans le journal **« Activité récente »** (R2.6) ;
- le script généré est validé par `CHECKSCRIPT` avant d'être activé.

### Tests

- API (testeur aveugle) contre un faux serveur ManageSieve en mémoire.
- Intégration contre le conteneur Dovecot : créer un filtre, envoyer un message par SMTP,
  **vérifier qu'il arrive dans le bon dossier**. C'est la seule preuve qui compte.

---

## R3 — langue et aide

Inchangé (voir PLAN-v3) : toute l'interface en FR / EN, choix dans les paramètres, page
d'aide, plus une aide pour les filtres.

---

## P — Mise en production

1. **Déploiement** : build Nuxt, service systemd, Apache en proxy inverse sur `/colombe`,
   `NUXT_MAIL_TRUST_PROXY=true`, génération des clés (`NUXT_SESSION_PASSWORD`,
   `WEBMAIL_DATA_KEY`), sauvegarde quotidienne de la base SQLite (la clé est sauvegardée
   **à part**).
2. **Validation sur Dovecot réel** : toute la suite API en mode IMAP contre le conteneur
   Dovecot, puis test avec un compte de test sur le serveur, avec l'admin.
3. **Charge** : 348 comptes. Vérifier `mail_max_userip_connections` de Dovecot : IDLE
   ouvre une connexion par session, et tous les étudiants sortent derrière la même IP NAT.
4. **Revue de sécurité** : en-têtes (CSP, HSTS), `pnpm audit`, corpus de charges XSS contre
   l'assainisseur, limites de débit, journaux.
5. **Migration depuis Roundcube** :
   - par l'utilisateur : Roundcube → Contacts → Exporter (.vcf), puis Colombe →
     Importer (R2.3) ;
   - option admin (sur feu vert) : script ponctuel qui lit la base Roundcube (contacts,
     groupes, identités, signatures, réponses types) et remplit la base de Colombe.
6. **Bascule** : Colombe en parallèle sur `/colombe`, groupe pilote (personnels),
   puis remplacement de `/webmail`.

> **À faire sans attendre Colombe** : RainLoop 1.17 est encore actif sur `/webmail`,
> sans correctif depuis 2022. Il devrait être coupé dès que les utilisateurs ont
> Roundcube.

---

## Toujours hors périmètre

| Fonction | Raison |
|---|---|
| Changement de mot de passe | décision : hors webmail |
| Chiffrement PGP (enigma) | gestion de clés hors du besoin actuel |
| Partage de dossiers (ACL) | plugin ACL de Dovecot non configuré ; à revoir après F |

## Méthode

- Agents de développement et testeurs aveugles sur **Sonnet** (et non plus Haiku).
- Le testeur n'a jamais accès au code (`app/`, `server/`, `shared/`) : il écrit ses tests
  depuis ce document et PLAN-v3.
- Chaque vague est vérifiée par l'orchestrateur (suites relancées, revue de code et
  contrôle dans le navigateur) avant commit.
