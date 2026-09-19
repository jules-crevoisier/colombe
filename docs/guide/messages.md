# Lire, écrire, répondre

Ce que vous pouvez faire avec vos messages au quotidien : lire, écrire, répondre,
transférer, joindre des fichiers, retrouver un brouillon, chercher un message, organiser
vos dossiers, et ce que Colombe fait pour votre sécurité en arrière-plan.

## Lire un message

Cliquez sur un message dans la liste. S'il contient de la mise en forme (HTML), elle est
affichée si l'option **Afficher le HTML** est activée dans **Paramètres → Affichage** ;
sinon vous voyez le texte brut.

::: tip Images distantes
Chaque image chargée depuis un autre serveur peut servir à confirmer que vous avez ouvert
le message (pixel de suivi). Colombe les bloque par défaut : un bandeau vous propose de
les afficher pour ce message. Dans **Paramètres → Affichage**, vous pouvez choisir de les
afficher automatiquement pour vos contacts, ou toujours.
:::

Un message avec plusieurs échanges (réponses successives) peut être groupé en
**conversation** si l'option est activée dans **Paramètres → Général** : les autres
messages du fil apparaissent au-dessus et en dessous.

## Écrire et répondre

**Nouveau message** (bouton, ou raccourci `c`) ouvre une fenêtre de rédaction. Depuis un
message ouvert : **Répondre** (`r`), **Répondre à tous** (`a`) ou **Transférer** (`f`).

- La liste des destinataires propose vos contacts au fur et à mesure de la saisie.
- L'éditeur peut être en texte mis en forme ou en texte brut selon vos préférences
  (**Paramètres → Rédaction**), et la position de votre réponse par rapport au texte cité
  (au-dessus ou en dessous) s'y règle aussi.
- Un brouillon est **enregistré automatiquement** pendant que vous écrivez : fermer la
  fenêtre ou l'onglet ne perd rien, vous le retrouvez dans **Brouillons**.
- Si vous avez plusieurs identités (adresses ou signatures différentes, réglées dans
  **Paramètres → Identités**), choisissez celle qui envoie le message.

### Annuler l'envoi

Un message envoyé ne part pas instantanément : selon le délai choisi dans
**Paramètres → Général** (désactivé, 5, 10 ou 20 secondes), un bouton **Annuler** reste
disponible juste après l'envoi. La suppression d'un message propose la même
annulation de courte durée avant de la rendre définitive.

## Pièces jointes

Glissez un fichier dans la fenêtre de rédaction, ou utilisez le bouton dédié. La taille
totale des pièces jointes d'un message est limitée (l'interface l'indique si vous
dépassez la limite fixée par votre établissement). Pour un message reçu, chaque pièce
jointe se télécharge individuellement, ou toutes ensemble en une archive zip ; vous pouvez
aussi exporter plusieurs messages sélectionnés dans la liste en zip.

## Recherche

Le champ de recherche, en haut de la liste, filtre les messages du dossier ouvert (objet,
expéditeur, contenu). Le raccourci `/` y place le curseur directement.

## Dossiers

En plus de la boîte de réception, des dossiers spéciaux (Envoyés, Brouillons, Corbeille,
Spam, Archives) apparaissent selon ce que votre serveur définit. Vous pouvez créer,
renommer et supprimer vos propres dossiers. Un message se classe par glisser-déposer vers
un dossier de la colonne de gauche, ou avec le bouton **Déplacer**. **Archiver** (`e`) le
range dans le dossier Archives en un geste ; **Supprimer** (`#`) le déplace vers la
Corbeille (ou l'efface définitivement, si vous avez choisi cette option dans
**Paramètres → Serveur**).

::: details Réglages liés au dossier, dans Paramètres → Serveur
- Vider la Corbeille à la déconnexion.
- Compacter la boîte de réception à la déconnexion (efface définitivement les messages
  déjà marqués supprimés, ce que d'autres logiciels de messagerie peuvent avoir laissé en
  attente).
- Supprimer définitivement au lieu de déplacer vers la Corbeille.
:::

## Conversations et fils de discussion

Avec la **vue conversation** activée (**Paramètres → Général**), les réponses successives
à un même message se regroupent visuellement lorsque vous en ouvrez un.

## Nouveaux messages en direct

Colombe surveille votre boîte de réception en continu : un nouveau message apparaît dans
la liste sans avoir à recharger la page, et une notification du bureau peut vous prévenir
si vous l'avez autorisée (**Paramètres → Général → Notifications du bureau**).

## Import de messages

Un fichier `.eml` (message exporté depuis un autre logiciel) peut être importé dans un
dossier, pour retrouver un ancien message ou terminer une migration.

## Et ensuite

- [Filtres, réponse automatique, transfert](/guide/filtres)
- [Contacts](/guide/contacts)
- [Raccourcis clavier](/guide/raccourcis)
