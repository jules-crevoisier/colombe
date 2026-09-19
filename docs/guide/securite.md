# Sécurité de votre compte

**Paramètres → Sécurité** réunit votre historique de connexion, vos sessions actives et la
double authentification.

## Double authentification (TOTP)

Facultative, mais recommandée : elle ajoute un second facteur (un code à 6 chiffres,
renouvelé toutes les 30 secondes) en plus de votre mot de passe pour vous connecter au
webmail.

1. **Activer la double authentification** affiche un QR code à scanner avec une
   application d'authentification (Aegis, FreeOTP, Google Authenticator, ou équivalent) —
   ou une clé à saisir à la main si vous préférez.
2. Entrez le code à 6 chiffres affiché par l'application pour confirmer.
3. Colombe affiche alors des **codes de secours**, à usage unique, à enregistrer dans un
   endroit sûr (gestionnaire de mots de passe, papier). Ils ne s'affichent qu'une seule
   fois : copiez-les ou téléchargez-les avant de continuer. Ils permettent de vous
   connecter si vous perdez l'accès à votre application d'authentification.

Une fois activée, la page indique combien de codes de secours il vous reste, propose de
les **régénérer** (avec un code TOTP ou un code de secours existant) et de **désactiver**
la double authentification si besoin.

::: warning Ce que la double authentification protège
Elle protège uniquement la connexion au **webmail**. Un logiciel de messagerie configuré
en IMAP/SMTP (Thunderbird, l'application Gmail, Outlook…) continue de se connecter avec
votre mot de passe seul — voir
[Lire son courrier dans une autre application](/guide/autres-applications).
:::

## Dernière connexion et activité récente

La page affiche votre dernière connexion (date, IP, appareil) et les tentatives de
connexion récentes, réussies ou échouées, avec la même information. Une modification
sensible de vos filtres (transfert, redirection) y apparaît aussi. Une ligne que vous ne
reconnaissez pas est un signal à prendre au sérieux : changez votre mot de passe et
prévenez votre établissement.

## Sessions actives

La liste des appareils actuellement connectés à votre compte (navigateur, date de
dernière activité). **Déconnecter les autres sessions** ferme toutes les sessions sauf
celle que vous utilisez en ce moment — utile après avoir prêté un ordinateur, ou en cas de
doute.

## Bonnes pratiques anti-hameçonnage

- Colombe ne vous demandera **jamais** votre mot de passe par e-mail, ni par un lien dans
  un message.
- Vérifiez l'adresse du site avant de saisir votre mot de passe : celle que vous a donnée
  votre établissement, toujours en HTTPS.
- Un e-mail « transfert modifié sur votre compte » que vous n'avez pas demandé : changez
  votre mot de passe immédiatement (voir [Filtres](/guide/filtres) pour ce qui déclenche
  cette alerte).
- Le contenu HTML des messages reçus est assaini avant affichage et les images distantes
  sont bloquées par défaut : deux protections déjà actives sans rien à faire de votre
  part.
