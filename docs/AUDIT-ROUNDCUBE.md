# Audit : Roundcube 1.6 → Courrielle

Objectif : Courrielle doit pouvoir **remplacer Roundcube pour tous les comptes** de
`mmi-troyes.fr`. Source de l'audit : dépôt officiel `roundcube/roundcubemail`, branche
`release-1.6` (actions `program/actions/{mail,settings,contacts}` + 37 plugins fournis).

Légende : ✅ présent · 🟡 partiel · ❌ manquant · ⛔ hors périmètre (motif indiqué)

## 1. Messagerie

| Roundcube | Courrielle | Lot |
|---|---|---|
| Liste paginée, tri par date | ✅ | — |
| Tri par expéditeur / objet / taille, ordre inversé | ❌ | R1 |
| Volet de lecture (liste + message côte à côte) | ❌ (liste puis page) | R2 |
| Vue en fils (liste regroupée) | 🟡 conversation à la lecture | R2 |
| Lu / non lu, suivi (étoile) | ✅ | — |
| Marquer tout le dossier comme lu | ❌ | R1 |
| Répondu / transféré (indicateurs \Answered, $Forwarded) | ❌ | R1 |
| Déplacer, supprimer, archiver, glisser-déposer | ✅ | — |
| Copier vers un dossier | ❌ | R1 |
| Spam / pas un spam (markasjunk) | ❌ | R1 |
| Vider la corbeille / le spam | ❌ | R1 |
| Recherche simple | ✅ | — |
| Recherche avancée : champs (objet, de, à, cc, corps), portée (dossier / tous), filtres (non lus, suivis, sans réponse, avec pièce jointe), période | ❌ | R1 |
| Imprimer un message | ❌ | R1 |
| Afficher la source, télécharger en .eml | ❌ | R1 |
| Afficher tous les en-têtes (show_additional_headers) | ❌ | R1 |
| Transférer en pièce jointe | ❌ | R1 |
| Rediriger (bounce) | ❌ | R1 |
| Importer des .eml dans un dossier | ❌ | R1 |
| Télécharger une sélection en .zip (zipdownload) | ❌ | R1 |
| Télécharger toutes les pièces jointes en .zip | ❌ | R1 |
| Aperçu des pièces jointes image / texte | ❌ | R1 |
| Masquer les citations (hide_blockquote) | ❌ | R1 |
| Accusé de lecture : demander (compose) et répondre (lecture) | ❌ | R1 |
| Priorité d'un message (envoi + affichage) | ❌ | R1 |
| Pièce jointe vCard → « Ajouter aux contacts » (vcard_attachments) | ❌ | R2 |
| Images distantes : bloquées, affichage ponctuel | ✅ | — |
| Images distantes : toujours pour les contacts connus | ❌ | R2 |
| Préférer HTML / texte brut | ❌ | R2 |
| Notification nouveau message (newmail_notifier) | ✅ | — |

## 2. Rédaction

| Roundcube | Courrielle | Lot |
|---|---|---|
| Éditeur HTML, texte brut | 🟡 riche uniquement | R2 |
| Brouillons automatiques | ✅ | — |
| Pièces jointes (sélecteur de fichiers) | ✅ | — |
| Glisser-déposer des fichiers dans l'éditeur | ❌ | R1 |
| Rappel « pièce jointe oubliée » (attachment_reminder) | ❌ | R1 |
| Correcteur orthographique | 🟡 celui du navigateur | R1 (activer explicitement) |
| Identités multiples (nom, répondre à, cci, signature par identité) | ❌ | R2 |
| Réponses types (responses) | ❌ | R2 |
| Mode de réponse : au-dessus / en dessous de la citation | ❌ | R2 |
| Réponse à la liste (List-Post) | ❌ | R2 |
| Signature | ✅ | — |
| Priorité, accusé de lecture, accusé de remise (DSN) | ❌ | R1 |
| Annuler l'envoi | ✅ (en plus de Roundcube) | — |

## 3. Carnet d'adresses

| Roundcube | Courrielle | Lot |
|---|---|---|
| Contacts, recherche, autocomplétion | ✅ | — |
| Adresses collectées automatiquement | ✅ | — |
| Fiche complète (prénom, nom, plusieurs e-mails et téléphones, organisation, adresse, notes) | ❌ (nom + e-mail) | R2 |
| Groupes : créer, renommer, supprimer, membres, écrire au groupe | ❌ | R2 |
| Import / export vCard, import CSV | ❌ | R2 |
| Ajouter l'expéditeur aux contacts depuis un message | ❌ | R2 |

## 4. Dossiers

| Roundcube | Courrielle | Lot |
|---|---|---|
| Créer, renommer, supprimer | ✅ | — |
| Sous-dossiers, déplacer un dossier | 🟡 création à la racine | R2 |
| Abonnement / désabonnement (subscriptions_option) | ❌ | R2 |
| Taille d'un dossier, quota de la boîte | ❌ | R2 |
| Vider un dossier | ❌ | R1 |
| Choix des dossiers spéciaux (Envoyés, Brouillons…) | ❌ | R2 |

## 5. Paramètres

| Roundcube | Courrielle | Lot |
|---|---|---|
| Langue (FR / EN) | ❌ | R3 |
| Fuseau horaire, format de date et d'heure, dates relatives | ❌ | R2 |
| Marquer comme lu : immédiatement / après N s / jamais | ❌ | R2 |
| Messages par page, densité | ✅ | — |
| Serveur : vider la corbeille / compacter à la déconnexion, suppression définitive au lieu de la corbeille | ❌ | R2 |
| Thème sombre | ✅ | — |

## 6. Sécurité et compte

| Roundcube | Courrielle | Lot |
|---|---|---|
| Déconnexion automatique après inactivité (autologout) | 🟡 côté serveur (2 h) | R2 (avertissement + réglage) |
| Informations de compte : dernière connexion (userinfo) | ❌ | R2 (+ adresse IP : utile après l'incident) |
| Sessions actives, déconnecter les autres appareils | ❌ (au-delà de Roundcube) | R2 |
| Double authentification | ✅ (au-delà de Roundcube) | — |
| Changement de mot de passe (password) | ⛔ décision : hors webmail | — |
| Filtres, réponse automatique, transfert (managesieve) | ⛔ bloqué : ManageSieve absent du serveur (port 4190) | après feu vert admin |
| Chiffrement PGP (enigma) | ⛔ gestion de clés hors du besoin actuel ; à réévaluer | — |
| Partage de dossiers (acl) | ⛔ nécessite le plugin ACL de Dovecot, non configuré | — |

## 7. Plugins d'infrastructure (non applicables)

`autologon`, `http_authentication`, `krb_authentication`, `virtuser_file`, `virtuser_query`,
`squirrelmail_usercopy`, `database_attachments`, `filesystem_attachments`,
`redundant_attachments`, `debug_logger`, `example_addressbook`, `jqueryui`, `reconnect` :
mécanismes internes de Roundcube sans équivalent fonctionnel attendu par l'utilisateur.
`identicon` → remplacé par les avatars à initiales. `emoticons` → sélecteur d'émojis du
système. `help` → aide des raccourcis (`?`) + page d'aide en R3. `new_user_dialog` /
`new_user_identity` → première connexion : proposer le nom affiché (R2, identités).

## Synthèse

| | Nombre |
|---|---|
| ✅ présent | 21 |
| 🟡 partiel | 7 |
| ❌ manquant | 42 |
| ⛔ hors périmètre justifié | 4 (+13 plugins d'infrastructure) |

Plan de réalisation : [PLAN-v3.md](PLAN-v3.md).
