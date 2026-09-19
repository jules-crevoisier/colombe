# Lire son courrier dans Gmail, Outlook, sur iPhone…

Votre boîte de l'établissement fonctionne avec n'importe quel logiciel de messagerie.
Dans Colombe, ouvrez **Paramètres → Autres applications** : vous y trouverez vos réglages
exacts (serveur, port, identifiant), un pas-à-pas pour chaque application, et un QR code
pour rouvrir cette page directement sur votre téléphone.

Le mot de passe à saisir est **celui de votre messagerie**. La double authentification de
Colombe ne s'applique qu'au webmail : voir
[Sécurité de votre compte](/guide/securite#double-authentification-totp).

::: tip Page pas encore disponible ?
Si votre établissement n'a pas encore publié ces réglages, l'onglet l'indique : votre
messagerie reste utilisable dans Colombe en attendant.
:::

## Gmail

### Sur téléphone (Android ou iPhone)

L'application Gmail peut afficher votre boîte à côté de votre compte Gmail :

1. Gmail → photo de profil → **Ajouter un autre compte** → **Autre**.
2. Saisissez votre adresse de l'établissement, choisissez **Personnel (IMAP)**.
3. Mot de passe de votre messagerie.
4. Serveur entrant et sortant : les valeurs indiquées dans **Autres applications**
   (le plus souvent détectées automatiquement).

### Sur ordinateur (gmail.com)

Depuis 2026, Gmail sur le web **ne relève plus** les boîtes d'autres fournisseurs
(fonctions « Consulter d'autres comptes » et Gmailify arrêtées par Google). Deux
possibilités :

- utiliser l'application Gmail sur téléphone (ci-dessus) ;
- **faire suivre** votre courrier vers votre adresse Gmail : **Paramètres → Transfert**.
  Cette option n'est disponible que si votre établissement autorise les adresses Gmail ;
  l'onglet indique les domaines autorisés. Par sécurité, on vous redemande votre mot de
  passe (ou votre code de double authentification) et un e-mail vous prévient de chaque
  modification — voir [Filtres, réponse automatique, transfert](/guide/filtres).

Pour **répondre depuis Gmail avec votre adresse de l'établissement** (« Envoyer des
e-mails en tant que ») : dépliez **Répondre depuis Gmail avec votre adresse**, dans
l'onglet Gmail des paramètres, pour les étapes détaillées avec vos propres valeurs de
serveur SMTP.

## iPhone et iPad (Mail)

Dans **Autres applications → iPhone / iPad**, cliquez sur **Télécharger le profil de
configuration**, puis : Réglages → **Profil téléchargé** → Installer. Le profil ne
contient pas votre mot de passe : il vous est demandé à l'installation. iOS l'affiche
comme « Non signé », c'est normal. Un pas-à-pas pour une configuration manuelle est aussi
disponible, si vous préférez ne pas installer de profil.

## Outlook, Thunderbird

Ajoutez un compte avec votre adresse et votre mot de passe : si votre établissement a
activé la configuration automatique, tout est rempli seul. Sinon, choisissez IMAP et
reprenez les valeurs de l'onglet **Autres applications**, section correspondante.

## Une autre application

L'onglet **Autre** donne la marche à suivre générale (choisir IMAP en réception, SMTP en
envoi) et le tableau complet de vos paramètres de connexion, pour tout logiciel non listé
ci-dessus.

## En cas de problème

- « Mot de passe incorrect » alors qu'il fonctionne dans Colombe : vérifiez l'identifiant
  (adresse complète ou seulement la partie avant @, indiqué dans la page).
- Trop de tentatives : l'accès est bloqué quelques minutes, puis revient seul.
- Autre souci : contactez le support de votre établissement (lien « Besoin d'aide ? » de
  la page de connexion).
