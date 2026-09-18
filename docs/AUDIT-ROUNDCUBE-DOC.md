# Audit Roundcube 1.6 — depuis la documentation officielle

Objectif : inventaire des fonctions et préférences **utilisateur** de Roundcube 1.6
telles que décrites dans sa documentation officielle (manuel utilisateur, wiki
GitHub, README/localisation des plugins livrés en `release-1.6`, écran de
préférences `program/actions/settings/index.php`), puis écart avec
[AUDIT-ROUNDCUBE.md](AUDIT-ROUNDCUBE.md), [PLAN-v3.md](PLAN-v3.md) et
[ROADMAP.md](ROADMAP.md).

Le manuel `1.6` n'existe pas à l'URL documentée (`/doc/help/1.6/en_US/` → 404) ;
c'est la version **1.1** du manuel qui est en ligne et sert de référence (voir
§ Sources inaccessibles). Beaucoup de plugins de `release-1.6` n'ont **pas** de
fichier `README` : pour ceux-là, la source citée est le fichier de
localisation `en_US.inc` (chaînes d'interface, exhaustives par nature) ou,
à défaut, le code source commenté du plugin.

Légende colonne 3 : **OUI (réf.)** = couvert, avec la ligne/le lot qui le couvre ;
**⛔** = déjà explicitement hors périmètre dans l'audit/la feuille de route ;
**NON** = absent des trois documents.

---

## A. Inventaire

### 1. Messagerie (liste, dossiers, aperçu)

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Liste des messages, pagination | mail/mailview.html | OUI (déjà présent, AUDIT §1) |
| Actualisation automatique périodique de la liste + bouton Actualiser | mail/mailview.html | NON |
| Intervalle d'actualisation configurable (jamais → 60 min) | settings/index.php `_refresh_interval` | NON |
| Aperçu au simple clic / ouverture au double-clic selon préférence | mail/mailview.html | 🟡 partiel (volet de lecture, PLAN R2.5) |
| Ouvrir un message dans une fenêtre externe séparée | settings/preferences.html `_message_extwin` | NON |
| Marquer lu/non lu (étoile), marquer/démarquer le suivi | mail/mailview.html | OUI (déjà présent, AUDIT §1) |
| Marquer en lot (lu/suivi) sur la sélection via un menu dédié | mail/mailview.html | OUI (implicite, mêmes actions qu'individuelles) |
| Tri par colonne (clic sur l'en-tête), ordre inversé | mail/mailview.html | OUI (PLAN R1.1) |
| Vue Liste / Fils (bouton de bascule) | mail/mailview.html | 🟡 partiel (ROADMAP R2.7 "regrouper par conversation") |
| Déploiement automatique des fils (jamais / toujours / non lus) | settings/index.php `_autoexpand_threads` | NON |
| Personnaliser les colonnes affichées et leur ordre (glisser-déposer les en-têtes) | mail/mailview.html | NON |
| Sélection multiple (Maj/Ctrl-clic) | mail/mailview.html | OUI (déjà présent, prérequis des actions groupées) |
| Sélection : Tous / Aucun / Non lus / Suivis / Inverser | mail/mailview.html | OUI (ROADMAP R2.7) |
| Dossiers : liste hiérarchique, compteur de non-lus, icônes spéciales | mail/mailview.html | OUI (déjà présent) |
| Développer/replier l'arborescence des dossiers | mail/mailview.html | OUI (déjà présent) |
| Compacter un dossier à la demande (bouton dédié) | mail/mailview.html | NON (seule la compaction à la déconnexion est prévue, PLAN R2.5) |
| Vider un dossier (Corbeille/Spam uniquement) | mail/mailview.html | OUI (PLAN R1.1) |
| Recherche/filtre par nom dans l'arborescence des dossiers | settings/folders.html | NON |
| Filtrer l'arborescence par espace de noms (Personnel / Partagé / Autres utilisateurs) | settings/folders.html | ⛔ même motif que le partage ACL (AUDIT §6) |
| Jauge de quota dans le pied de la liste des dossiers | mail/mailview.html | OUI (PLAN R2.4) |
| Volet d'aperçu : afficher/masquer, réponse/transfert rapides, ouverture en fenêtre externe | mail/mailview.html | 🟡 partiel (volet OUI R2.5 ; fenêtre externe NON) |
| Développer les en-têtes depuis l'aperçu (flèche) | mail/mailview.html | OUI (PLAN R1.3, "afficher tous les en-têtes") |

### 2. Lecture d'un message

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Ouverture en plein écran ou en nouvelle fenêtre au double-clic | mail/reading.html | NON (fenêtre externe, cf. ci-dessus) |
| Photo de l'expéditeur dans l'en-tête (si présente dans le carnet) | mail/reading.html | NON |
| Déplacer le message affiché vers un dossier (menu) | mail/reading.html | OUI (déjà présent) |
| Navigation message précédent/suivant depuis la lecture | mail/reading.html | NON |
| Ajouter l'expéditeur/destinataire aux contacts (icône) | mail/reading.html | OUI (PLAN R2.3) |
| Ouvrir/télécharger une pièce jointe, aperçu inline des types compatibles | mail/reading.html | OUI (PLAN R1.3) |
| Forcer le téléchargement (menu contextuel) d'un fichier normalement affichable | mail/reading.html | OUI (déjà couvert par le téléchargement) |
| Miniatures automatiques des images jointes sous le corps du message | mail/reading.html ; settings `_inline_images` | NON (distinct de l'aperçu au clic prévu en R1.3) |
| Repli automatique des citations, seuil configurable (nombre de lignes) | plugins/hide_blockquote (localisation `quotelimit`) | 🟡 partiel (repli OUI PLAN R1.3 ; seuil configurable NON) |
| Afficher tous les en-têtes reçus | show_additional_headers.php | OUI (PLAN R1.3, fonction plus complète) |
| Marquer comme spam / retirer du spam | markasjunk README | OUI (PLAN R1.1) |
| Archiver un message en un clic | organization.html | OUI (déjà présent, AUDIT §1) |
| Organisation du dossier Archive : par année / mois (variante Thunderbird) / expéditeur / dossier d'origine, ou combinaisons année+dossier / mois+dossier | plugins/archive localisation en_US.inc | NON |
| Marquer le message comme lu au moment de l'archivage | plugins/archive localisation (`readonarchive`) | NON |
| Télécharger toutes les pièces jointes d'un message en .zip | plugins/zipdownload README | OUI (PLAN R1.3) |
| Télécharger une sélection de messages en .zip | plugins/zipdownload README ; mail/importexport.html | OUI (PLAN R1.1) |
| Importer des fichiers MIME (.eml) et Mbox (.mbox) dans un dossier | mail/importexport.html | 🟡 partiel (PLAN R1.1 : .eml seulement, pas .mbox) |
| Exporter un message individuel en .eml | mail/importexport.html | OUI (PLAN R1.3) |
| Ajouter une pièce jointe vCard au carnet d'adresses ; "Transférer la vCard" | plugins/vcard_attachments localisation en_US.inc | OUI (PLAN R2.3) |

### 3. Rédaction

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Compose : destinataire, objet, corps, envoi | mail/compose.html | OUI (déjà présent) |
| Brouillon manuel et enregistrement automatique périodique | mail/compose.html | OUI (déjà présent) ; intervalle configurable (jamais/1/3/5/10 min) NON (`_draft_autosave`) |
| Sauvegarde de secours du brouillon dans le localStorage du navigateur | settings `_compose_save_localstorage` | NON (à examiner au regard de la règle « pas d'identifiants en localStorage » — ici ce n'est pas un identifiant, mais absent du plan) |
| Répondre / Répondre à tous, citation de l'original | mail/compose.html | OUI (déjà présent, prérequis de PLAN R1.4) |
| "Réponse vide" (sans citation du message d'origine) | settings `_reply_mode` | NON |
| Transférer en ligne (éditable) ou en pièce jointe | mail/compose.html | OUI (PLAN R1.4 pour l'action ; préférence de **mode par défaut** `_forward_attachment` NON) |
| Autocomplétion du carnet, boutons À+/Cc+/Cci+ | mail/compose.html | OUI (déjà présent) |
| Pièce jointe : sélecteur de fichiers | mail/compose.html | OUI (déjà présent) |
| Glisser-déposer des fichiers dans la fenêtre de rédaction | mail/compose.html | OUI (PLAN R1.6) |
| Éditeur HTML avec barre de mise en forme, insertion d'image | mail/compose.html | 🟡 partiel (HTML/texte brut OUI R2.5 ; mode fin `_htmleditor` en 5 niveaux NON ; police/taille par défaut NON) |
| Insertion d'image dans le corps ou la signature (glisser-déposer, coller) | settings/identities.html | OUI (ROADMAP R2.1b) |
| Réponses types : insérer, créer une nouvelle réponse | mail/compose.html | OUI (PLAN R2.2) |
| Priorité, accusé de lecture, accusé de remise (options d'envoi) | mail/compose.html | OUI (PLAN R1.5) |
| Demander systématiquement un accusé de lecture / de remise par défaut (préférence globale) | settings `_mdn_default`, `_dsn_default` | NON |
| Comportement global face à un accusé demandé par un tiers (toujours demander / auto-envoyer / auto pour contacts connus / ignorer) | settings `_mdn_requests` | 🟡 partiel (PLAN R1.5 ne fait que le bandeau par message, pas la préférence globale à 6 valeurs) |
| Choisir le dossier d'enregistrement du message envoyé, ou ne pas l'enregistrer, à l'envoi | mail/compose.html | NON |
| Action par défaut du bouton "Répondre à tous" sur une liste de diffusion | settings `_reply_all_mode` | 🟡 partiel (le bouton "Répondre à la liste" existe, ROADMAP R2.7 ; pas de préférence de comportement par défaut) |
| Correcteur orthographique : vérifier avant envoi, ignorer majuscules/chiffres/symboles | settings `_spellcheck_*` | NON (AUDIT note déjà le correcteur comme "🟡 celui du navigateur") |
| Rappel de pièce jointe oubliée | plugins/attachment_reminder localisation (mots-clés) | OUI (PLAN R1.6) |
| Signature : insertion automatique fine (jamais/toujours/nouveaux messages/réponses-transferts), position au-dessus/en dessous, suppression de la signature existante, séparateur `-- ` | settings `_show_sig`, `_sig_below`, `_strip_existing_sig`, `_sig_separator` | 🟡 partiel (signature simple OUI ; ces réglages fins NON) |
| Identités multiples : nom, répondre-à, cci, organisation, signature | settings/identities.html | OUI (PLAN R2.1) |
| Jeu de caractères par défaut à la composition/lecture | settings `_default_charset` | NON |
| Afficher l'adresse e-mail au lieu du nom affiché de l'expéditeur | settings `_message_show_email` | NON |
| Composer dans une fenêtre externe séparée | settings `_compose_extwin` | NON |

### 4. Carnet d'adresses

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Liste de contacts, recherche simple, autocomplétion | addressbook/addressbookview.html | OUI (déjà présent) |
| Recherche par champ choisi (nom/e-mail/tous les champs), recherche avancée multi-critères | addressbook/searching.html | NON |
| Enregistrer / rappeler / supprimer une recherche (apparaît comme un groupe) | addressbook/searching.html | NON |
| Groupes : créer, renommer, supprimer, glisser-déposer des contacts dedans/dehors | addressbook/addressbookview.html | OUI (PLAN R2.3) |
| Écrire un message à un contact ou à un groupe entier | addressbook/addressbookview.html | OUI (PLAN R2.3) |
| Fiche contact complète : civilité/prénom/nom, plusieurs e-mails et téléphones typés, organisation, adresse, notes | addressbook/editing.html | OUI (PLAN R2.3) |
| Photo de contact : ajouter / remplacer / supprimer | addressbook/editing.html | NON |
| Import vCard (.vcf) et CSV, avec case "vider le carnet avant import" | addressbook/importexport.html | 🟡 partiel (import OUI PLAN R2.3 ; case "vider avant import" NON) |
| Export vCard : tous les contacts ou une sélection | addressbook/importexport.html | OUI (PLAN R2.3) |
| Format d'affichage du nom dans la liste (Nom / Prénom Nom / Nom Prénom / Nom, Prénom) | settings `_addressbook_name_listing` | NON |
| Colonne de tri de la liste de contacts | settings `_addressbook_sort_col` | NON |
| Nombre de contacts par page | settings `_addressbook_pagesize` | NON |
| Mode du formulaire de contact (Personnel / Professionnel) | settings `_contact_form_mode` | NON |
| Ignorer les adresses alternatives dans l'autocomplétion | settings `_autocomplete_single` | NON |
| Choisir le carnet cible pour les adresses collectées automatiquement (destinataires / expéditeurs de confiance) | settings `_collected_recipients`, `_collected_senders` | 🟡 partiel (collecte OUI, déjà présent ; choix du carnet cible NON — un seul carnet dans Courrielle) |
| Adresse par défaut utilisée à la composition (carnet par défaut) | settings `_default_addressbook` | ⛔ sans objet (un seul carnet dans Courrielle) |

### 5. Dossiers

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Créer / renommer / supprimer un dossier | settings/folders.html | OUI (déjà présent) |
| Sous-dossiers, déplacer un dossier (glisser-déposer ou propriétés) | settings/folders.html | 🟡 partiel (PLAN R2.4) |
| Abonnement/désabonnement par dossier | settings/folders.html ; plugins/subscriptions_option | OUI (PLAN R2.4) |
| Interrupteur global activant/désactivant l'usage des abonnements IMAP | plugins/subscriptions_option localisation (`useimapsubscriptions`) | NON |
| Taille d'un dossier, quota de la boîte | settings/folders.html | OUI (PLAN R2.4) |
| Choix des dossiers spéciaux (Envoyés/Brouillons/Corbeille/Spam/Archives) | settings/folders.html | OUI (PLAN R2.4) |
| Afficher les noms réels des dossiers spéciaux (au lieu des noms traduits) | settings `_show_real_foldernames` | NON |
| Partage de dossiers, droits d'accès (ACL) | plugins/acl localisation en_US.inc | ⛔ hors périmètre, ACL Dovecot non configuré (AUDIT §6) |

### 6. Paramètres — une ligne par préférence

| Préférence | Valeurs possibles | Source | Déjà couvert ? |
|---|---|---|---|
| Langue | liste dynamique des langues installées | settings `_language` | OUI (ROADMAP R3) |
| Fuseau horaire | Détection auto, ou fuseau IANA | settings `_timezone` | OUI (PLAN R2.5 `timeZone`) |
| Format de l'heure | `G:i`, `H:i`, `g:i a`, `h:i A` | settings `_time_format` | OUI (PLAN R2.5 `timeFormat`) |
| Format de la date | `Y-m-d`, `d-m-Y`, `Y/m/d`, `m/d/Y`, `d/m/Y`, `d.m.Y`, `j.n.Y` | settings `_date_format` | OUI (PLAN R2.5 `dateFormat`) |
| Dates relatives ("Aujourd'hui", "Hier") | Case à cocher | settings `_pretty_date` | OUI (PLAN R2.5, valeur `relative`) |
| Après suppression/déplacement, afficher le message suivant | Case à cocher | settings `_display_next` | NON |
| Intervalle d'actualisation de la liste | Jamais, 1/3/5/10/15/30/60 min | settings `_refresh_interval` | NON |
| Apparence (skin) | Liste des habillages installés | settings `_skin` | OUI (équivalent réduit : thème sombre, un seul habillage) |
| Popups en fenêtres standard du navigateur | Case à cocher | settings `_standard_windows` | NON |
| S'enregistrer comme gestionnaire de liens `mailto:` | Action | settings `mailtoprotohandler` | NON |
| Disposition (Widescreen/Bureau/Liste) | 3 choix | settings `_layout` | 🟡 partiel (réduit à volet de lecture oui/non, PLAN R2.5 `readingPane`) |
| Marquer comme lu automatiquement | Jamais, immédiat, 5/10/20/30 s | settings `_mail_read_time` | 🟡 partiel (PLAN R2.5 `markReadDelay` ne propose que 0/5/10/jamais) |
| Déploiement automatique des fils | Jamais, Développer, Développer non lus seulement | settings `_autoexpand_threads` | NON |
| Messages par page | Nombre | settings `_mail_pagesize` | OUI (déjà présent) |
| Vérifier tous les dossiers (pas seulement la boîte de réception) | Case à cocher | settings `_check_all_folders` | NON |
| Ouvrir le message dans une fenêtre externe | Case à cocher | settings `_message_extwin` | NON |
| Afficher l'e-mail au lieu du nom de l'expéditeur | Case à cocher | settings `_message_show_email` | NON |
| Préférer le HTML à la lecture | Case à cocher | settings `_prefer_html` | OUI (PLAN R2.5 `preferHtml`) |
| Jeu de caractères par défaut | Liste des jeux de caractères | settings `_default_charset` | NON |
| Images distantes | Jamais / De mes contacts / Des expéditeurs de confiance / Toujours (4 valeurs) | settings `_show_images` | 🟡 partiel (PLAN R2.5 `remoteImages` n'a que 3 valeurs, sans "expéditeurs de confiance") |
| Comportement face à une demande d'accusé de lecture | Demander / Auto-envoyer / Auto pour connus / Auto pour connus sans avertir / Auto pour confiance / Auto pour confiance sans avertir / Ignorer (7 valeurs) | settings `_mdn_requests` | NON (préférence globale absente ; PLAN R1.5 ne fait qu'un bandeau par message) |
| Afficher les images jointes en miniature sous le message | Case à cocher | settings `_inline_images` | NON |
| Composer dans une fenêtre externe | Case à cocher | settings `_compose_extwin` | NON |
| Éditeur HTML | Jamais / En réponse / En réponse et transfert / Toujours / Toujours sauf texte brut (5 valeurs) | settings `_htmleditor` | 🟡 partiel (PLAN R2.5 `composeHtml` n'a que 2 valeurs) |
| Enregistrement automatique des brouillons | Jamais, 1/3/5/10 min | settings `_draft_autosave` | 🟡 partiel (comportement fixe déjà présent, intervalle non configurable) |
| Repliement des paramètres MIME | RFC 2231 / repliement classique / RFC 2047 | settings `_mime_param_folding` | NON |
| Forcer l'encodage 7 bits | Case à cocher | settings `_force_7bit` | NON |
| Toujours demander un accusé de lecture | Case à cocher | settings `_mdn_default` | NON |
| Toujours demander un accusé de remise | Case à cocher | settings `_dsn_default` | NON |
| Répondre dans le dossier du message d'origine | Case à cocher | settings `_reply_same_folder` | NON |
| Mode de réponse | Réponse vide / Citation en dessous / Citation au-dessus / Citation au-dessus sans retrait (4 valeurs) | settings `_reply_mode` | 🟡 partiel (PLAN R2.5 `replyPosition` n'a que 2 valeurs, pas de "réponse vide") |
| Correction avant envoi | Case à cocher | settings `_spellcheck_before_send` | NON |
| Correcteur : ignorer symboles / chiffres / majuscules | 3 cases à cocher | settings `_spellcheck_ignore_*` | NON |
| Insertion automatique de la signature | Jamais / Toujours / Nouveaux messages seulement / Réponses-transferts seulement (4 valeurs) | settings `_show_sig` | 🟡 partiel (signature simple OUI, ce réglage fin NON) |
| Signature en dessous de la réponse | Case à cocher | settings `_sig_below` | NON |
| Supprimer la signature existante à la réponse | Case à cocher | settings `_strip_existing_sig` | NON |
| Séparateur de signature `-- ` | Case à cocher | settings `_sig_separator` | NON |
| Mode de transfert par défaut | En ligne / En pièce jointe | settings `_forward_attachment` | 🟡 partiel (action ponctuelle OUI PLAN R1.4, préférence de défaut NON) |
| Police par défaut de l'éditeur HTML | Liste de polices | settings `_default_font` | NON |
| Taille de police par défaut | Vide, 8 à 36 pt | settings `_default_font_size` | NON |
| Action par défaut de "Répondre à tous" | Par défaut / Mode liste | settings `_reply_all_mode` | NON |
| Sauvegarde du brouillon en cours dans le localStorage du navigateur | Case à cocher | settings `_compose_save_localstorage` | NON |
| Carnet d'adresses par défaut | Liste des carnets | settings `_default_addressbook` | ⛔ sans objet (un seul carnet) |
| Affichage du nom dans la liste de contacts | Nom / Prénom Nom / Nom Prénom / Nom, Prénom (4 valeurs) | settings `_addressbook_name_listing` | NON |
| Colonne de tri du carnet | Nom / Prénom / Nom de famille | settings `_addressbook_sort_col` | NON |
| Contacts par page | Nombre | settings `_addressbook_pagesize` | NON |
| Mode du formulaire de contact | Personnel / Professionnel | settings `_contact_form_mode` | NON |
| Ignorer les adresses secondaires en autocomplétion | Case à cocher | settings `_autocomplete_single` | NON |
| Carnet cible des destinataires collectés | Aucun / Destinataires collectés / liste des carnets | settings `_collected_recipients` | ⛔ sans objet (un seul carnet) |
| Carnet cible des expéditeurs de confiance | Expéditeurs de confiance / liste des carnets | settings `_collected_senders` | ⛔ sans objet (un seul carnet) |
| Afficher les noms réels des dossiers spéciaux | Case à cocher | settings `_show_real_foldernames` | NON |
| Dossiers spéciaux (Brouillons/Envoyés/Spam/Corbeille) | Sélecteur de dossier | settings `_drafts_mbox` etc. | OUI (PLAN R2.4 `specialFolders`) |
| Marquer comme lu à la suppression | Case à cocher | settings `_read_when_deleted` | NON |
| Indicateur de suppression au lieu de déplacer | Case à cocher | settings `_flag_for_deletion` | NON |
| Ne pas afficher les messages marqués supprimés | Case à cocher | settings `_skip_deleted` | NON |
| Supprimer directement le contenu du dossier Spam | Case à cocher | settings `_delete_junk` | NON |
| Purger la corbeille à la déconnexion | Jamais / Tous les messages / Plus de 30 j / 60 j / 90 j (5 valeurs) | settings `_logout_purge` | 🟡 partiel (PLAN R2.5 `logoutEmptyTrash` n'est qu'un booléen tout/rien) |
| Compacter la boîte de réception à la déconnexion | Case à cocher | settings `_logout_expunge` | OUI (PLAN R2.5 `logoutExpunge`) |
| Chiffrement Mailvelope (client, différent de l'Enigma serveur) | Case à cocher + état | settings Encryption block | ⛔ même motif que le chiffrement PGP (AUDIT §6) |

### 7. Filtres (managesieve)

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Filtres exécutés côté serveur (Sieve), organisés par ordre, activables/désactivables individuellement | managesieve helpdocs settings-filters.rst | OUI (ROADMAP §F, sous réserve de ManageSieve activé côté admin) |
| Réordonner par glisser-déposer et par boutons Monter/Descendre | managesieve helpdocs settings-filters.rst | OUI (ROADMAP §F) |
| Conditions simples : De, À/Cc, Objet, Taille, En-tête libre — opérateurs contient/ne contient pas/est/n'est pas/commence par | managesieve localisation en_US.inc | OUI (ROADMAP §F) |
| Conditions avancées : date de réception, partie d'adresse (domaine/local/utilisateur/détail), enveloppe, comparateurs (octet/insensible à la casse/numérique), tests de comptage ou de valeur, contenu/type MIME, niveau de spam, détection de doublon | managesieve localisation en_US.inc (`datetest`, `address`, `envelope`, `comparator`, `countis*`, `spamtest`, `duplicate`) | NON |
| Actions simples : déplacer, copier, transférer/rediriger, supprimer, marquer comme lu/suivi, arrêter l'évaluation | managesieve helpdocs + localisation | OUI (ROADMAP §F) |
| Action "rejeter le message avec un message d'erreur personnalisé" | managesieve localisation (`messagediscard`) | NON |
| Actions avancées : ajouter/retirer un indicateur IMAP quelconque, ajouter/supprimer un en-tête, définir une variable, envoyer une notification (e-mail/téléphone/SMS) | managesieve localisation (`setflags`, `addheader`, `setvariable`, `notify*`) | NON |
| Créer un filtre depuis un message reçu (préremplit expéditeur/objet) | managesieve, cité par ROADMAP | OUI (ROADMAP §F) |
| Ensembles de filtres multiples : créer (vide ou copie), nommer, activer/désactiver, en avoir plusieurs actifs simultanément | managesieve helpdocs settings-filters.rst | NON (choix explicite : un seul script généré par Courrielle) |
| Éditer le script Sieve brut ; importer/exporter un ensemble sous forme de fichier script | managesieve helpdocs + localisation (`filterseteditraw`, "importer depuis un fichier") | NON (choix explicite de sécurité : on ne réanalyse jamais du Sieve arbitraire, ROADMAP §F) |
| Réponse automatique (vacation) : activer, dates de début/fin, objet, corps, ne pas répondre plus d'une fois tous les N jours | managesieve helpdocs settings-vacation.rst | OUI (ROADMAP §F) |
| Réponse automatique — réglages avancés : adresse d'expédition de la réponse, adresses e-mail supplémentaires reconnues comme "les miennes", action sur le message entrant (garder/rejeter/rediriger ou copier, en plus de répondre) | managesieve helpdocs settings-vacation.rst | NON |
| Transfert : rediriger tout le courrier vers une adresse, avec ou sans copie locale | managesieve localisation (`forward.redirect`, `forward.copy`) | OUI (ROADMAP §F) |

### 8. Sécurité et compte

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Changer son mot de passe (28 pilotes serveur possibles côté Roundcube, vérif. de robustesse zxcvbn / Have I Been Pwned) | plugins/password README | ⛔ décision : hors webmail (AUDIT §6) |
| Chiffrement/déchiffrement PGP, gestion de clés, clés jointes automatiquement | plugins/enigma README | ⛔ hors besoin actuel (AUDIT §6) |
| Partage de dossiers / droits d'accès (ACL) | plugins/acl localisation | ⛔ ACL Dovecot non configuré (AUDIT §6) |
| Informations de compte : date de création, dernière connexion, identité par défaut, identifiant utilisateur | plugins/userinfo localisation en_US.inc | 🟡 partiel (ROADMAP R2.6 couvre la dernière connexion + IP/navigateur, plus complet ; date de création et identifiant utilisateur NON) |
| Sessions actives, déconnecter les autres sessions | ROADMAP (au-delà de Roundcube) | OUI (ROADMAP R2.6) |
| Nouvelle tentative automatique de reconnexion IMAP après un échec transitoire (jusqu'à N tentatives), sans erreur visible pour l'utilisateur | plugins/reconnect readme.md | NON |
| Double authentification | — | OUI (au-delà de Roundcube, déjà présent) |

### 9. Divers

| Fonction | Source | Déjà couvert ? |
|---|---|---|
| Émoticônes : afficher dans le texte brut, sélecteur à la composition | plugins/emoticons localisation en_US.inc | OUI (substitué par le sélecteur d'émojis du système, AUDIT §7) |
| Notifications de nouveau message : navigateur, bureau, son, message de test | plugins/newmail_notifier localisation en_US.inc | OUI (AUDIT §1, "newmail_notifier ✅") |
| Superposition d'une pastille sur le favicon de l'onglet à l'arrivée d'un message | plugins/newmail_notifier (fichiers `favicon.ico`, `overlay.ico` du plugin) | NON (non confirmé côté Courrielle) |
| Aide contextuelle : lien "?", raccourcis clavier, page d'aide | AUDIT §7 ; plugins/help (contenu par défaut = simple page de licence) | OUI (ROADMAP R3) |
| Boîte de bienvenue au premier login proposant le nom affiché | plugins/new_user_dialog localisation en_US.inc | OUI (PLAN R2.1) |
| Redimensionner les zones de l'interface par glissement (ex. largeur du volet de lecture) | overview.html | NON |
| Tâches multiples ouvrables en fenêtres/onglets séparés, zone de statut, barre d'outils contextuelle | overview.html | OUI (déjà présent, structure de base de l'appli) |
| Terminer la session (bouton de déconnexion) | overview.html | OUI (déjà présent) |
| Connexion : identifiant + mot de passe + bouton Connexion (rien d'autre documenté : pas de sélecteur de serveur ni "se souvenir de moi" au niveau utilisateur) | login.html | OUI (déjà présent) |

---

## B. Manques non couverts

Chaque ligne = un comportement décrit par la documentation officielle de
Roundcube 1.6, absent des trois documents du projet.

**Messagerie / lecture**
1. Actualisation automatique périodique de la liste des messages, avec intervalle configurable (jamais à 60 min).
2. Ouvrir un message (ou la fenêtre de rédaction) dans une fenêtre de navigateur externe séparée.
3. Développer automatiquement les fils de discussion (jamais / toujours / non lus seulement).
4. Personnaliser les colonnes affichées dans la liste et leur ordre par glisser-déposer des en-têtes.
5. Compacter un dossier à la demande, indépendamment de la déconnexion.
6. Rechercher/filtrer par nom dans l'arborescence des dossiers.
7. Afficher la photo de l'expéditeur dans l'en-tête du message, depuis le carnet d'adresses.
8. Naviguer au message précédent/suivant directement depuis la vue de lecture.
9. Afficher automatiquement des miniatures pour les images jointes sous le corps du message (indépendamment de l'aperçu au clic déjà prévu).
10. Rendre configurable le seuil (nombre de lignes) qui déclenche le repli automatique d'une citation.
11. Marquer un message comme lu au moment de son archivage ; diviser le dossier Archive par année, mois (variante Thunderbird), expéditeur ou dossier d'origine, ou combinaisons de ces critères.
12. Importer aussi les fichiers au format Mbox (pas seulement des `.eml` individuels).
13. Afficher les noms réels des dossiers spéciaux au lieu de leur nom traduit.
14. Activer/désactiver globalement l'usage des abonnements aux dossiers IMAP.
15. Redimensionner les zones de l'interface (ex. largeur du volet de lecture) par glissement.

**Rédaction**
16. Choisir, à chaque envoi, le dossier où enregistrer le message envoyé, ou choisir de ne pas l'enregistrer.
17. Fixer un mode de transfert par défaut (en ligne / en pièce jointe), indépendamment de l'action ponctuelle.
18. Régler finement le mode de l'éditeur HTML (jamais / en réponse seulement / en réponse et transfert / toujours / toujours sauf texte brut) plutôt qu'un simple oui/non.
19. Rendre configurable l'intervalle d'enregistrement automatique des brouillons (jamais, 1, 3, 5 ou 10 min).
20. Sauvegarder une copie de secours du brouillon en cours dans le stockage local du navigateur.
21. Proposer une "réponse vide" qui ne cite pas le message d'origine.
22. Demander systématiquement, par préférence globale, un accusé de lecture et/ou de remise par défaut (pas seulement une case par envoi).
23. Définir un comportement global face aux accusés de lecture demandés par un expéditeur (toujours demander / auto-envoyer / auto pour les contacts connus / ignorer), au-delà du bandeau ponctuel déjà prévu.
24. Fixer une action par défaut du bouton "Répondre à tous" sur les messages de liste de diffusion.
25. Régler finement l'insertion de la signature (jamais / toujours / nouveaux messages seulement / réponses-transferts seulement), sa position au-dessus/en dessous du texte cité, la suppression de la signature existante à la réponse, et l'utilisation du séparateur standard `-- `.
26. Choisir une police et une taille par défaut pour l'éditeur HTML.
27. Choisir un jeu de caractères par défaut pour la lecture/composition des messages.
28. Afficher l'adresse e-mail plutôt que le nom affiché de l'expéditeur.
29. Activer des options fines du correcteur orthographique : vérifier avant envoi, ignorer les majuscules, les chiffres, les symboles.
30. Distinguer, pour les images distantes, un niveau "expéditeurs de confiance" séparé des "contacts" (3 niveaux au lieu de 2 dans le plan actuel).
31. Exposer les options techniques avancées : repliement des paramètres MIME (RFC 2231/2047), forçage de l'encodage 7 bits.

**Carnet d'adresses**
32. Rechercher dans le carnet par champ choisi (nom, e-mail, tous les champs) et lancer une recherche avancée multi-critères.
33. Enregistrer, rappeler et supprimer une recherche de contacts sauvegardée.
34. Ajouter, remplacer ou supprimer une photo de contact.
35. Proposer une case "vider le carnet avant import" lors d'un import CSV/vCard.
36. Choisir le format d'affichage du nom dans la liste de contacts (Nom / Prénom Nom / Nom Prénom / Nom, Prénom) et la colonne de tri.
37. Régler le nombre de contacts affichés par page, indépendamment de celui des messages.
38. Choisir un mode de formulaire de contact (Personnel / Professionnel).

**Paramètres serveur**
39. Marquer comme lu à la suppression ; utiliser un indicateur de suppression au lieu de déplacer vers la Corbeille ; masquer les messages marqués supprimés ; supprimer directement (sans passer par la Corbeille) le contenu du dossier Spam.
40. Purger la corbeille à la déconnexion selon l'ancienneté des messages (plus de 30/60/90 jours), pas seulement selon un choix tout-ou-rien.

**Divers**
41. Vérifier tous les dossiers, pas seulement la boîte de réception, pour la détection de nouveaux messages.
42. Ouvrir les fenêtres système comme des fenêtres standard du navigateur ; s'enregistrer comme gestionnaire de liens `mailto:`.
43. Afficher la date de création du compte et l'identifiant utilisateur dans les informations de compte.
44. Retenter automatiquement la connexion IMAP après un échec transitoire (jusqu'à N tentatives), sans afficher d'erreur à l'utilisateur.

**Filtres (managesieve)**
45. Gérer plusieurs ensembles de filtres nommés (créer vide ou par copie, activer/désactiver, avoir plusieurs actifs).
46. Éditer le script Sieve brut, et importer/exporter un ensemble de filtres sous forme de fichier script complet.
47. Ajouter des conditions de filtre avancées : date de réception, partie d'adresse (domaine/local/utilisateur), comparateurs (octet/insensible à la casse/numérique), tests de comptage ou de valeur, type/contenu MIME, niveau de spam, détection de doublon.
48. Ajouter des actions avancées : régler un indicateur IMAP quelconque (pas seulement lu/suivi), ajouter/supprimer un en-tête, définir une variable, envoyer une notification (e-mail, téléphone, SMS).
49. Ajouter l'action "rejeter le message avec un message d'erreur personnalisé".
50. Régler, pour la réponse automatique, l'adresse d'expédition de la réponse, les adresses e-mail supplémentaires reconnues comme siennes, et l'action sur le message entrant (garder/rejeter/rediriger ou copier, en plus de répondre).

---

## Sources inaccessibles

- `https://docs.roundcube.net/doc/help/1.6/en_US/` et `.../index.html` : 404. Le
  manuel utilisateur n'est pas publié pour la 1.6 ; utilisé à la place :
  `https://docs.roundcube.net/doc/help/1.1/en_US/` (fonctionnellement identique
  pour le périmètre MVP/v2 audité ici).
- READMEs de plugins absents en `release-1.6` (404 sur GitHub raw) : `managesieve`
  (remplacé par `plugins/managesieve/helpdocs/en_US/*.rst`), `archive`,
  `attachment_reminder`, `newmail_notifier`, `vcard_attachments`, `emoticons`,
  `hide_blockquote`, `show_additional_headers`, `userinfo`,
  `subscriptions_option`, `acl`, `help`, `new_user_dialog`, `identity_select`,
  `reconnect` (fichier réellement nommé `readme.md`, minuscule). Remplacés par
  le fichier de localisation `en_US.inc` (chaînes d'interface) ou le code
  source commenté quand la localisation n'existait pas non plus
  (`show_additional_headers.php`, `identity_select.php`).
- Page wiki GitHub dédiée aux raccourcis clavier ("Keyboard-Shortcuts") :
  introuvable — le wiki `roundcube/roundcubemail` ne liste ni page
  "Features" ni page "Keyboard-Shortcuts" séparée ; seules des pages
  d'installation/configuration/développement existent.
- `plugins/help/content/` en `release-1.6` ne contient qu'un `license.html` de
  démonstration : le contenu réel de la page d'aide est laissé à la charge de
  l'administrateur et n'est donc pas documenté de façon générique.
