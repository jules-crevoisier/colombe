# Filtres, réponse automatique, transfert

Trois réglages dans **Paramètres**, qui agissent directement sur votre boîte côté serveur
(ils continuent de fonctionner même quand Colombe ou votre navigateur est fermé) : les
filtres (onglet **Filtres**), la réponse automatique (**Réponse automatique**) et le
transfert (**Transfert**).

::: warning Fonction pas toujours disponible
Ces trois onglets dépendent d'un service du serveur de messagerie (ManageSieve). Si votre
établissement ne l'a pas activé, l'onglet l'indique simplement : « Les filtres ne sont pas
disponibles sur ce serveur. » Aucune de vos autres fonctions n'est affectée.
:::

## Filtres

Un filtre trie automatiquement le courrier qui arrive, façon Gmail : chaque règle est
activable/désactivable d'un geste, réordonnable (les filtres s'appliquent dans l'ordre),
modifiable ou supprimable depuis la liste. **Nouveau filtre** ouvre un formulaire pour
définir une condition (expéditeur, objet, destinataire…) et une ou plusieurs actions
(déplacer vers un dossier, marquer comme lu, etc.).

### Mode avancé

Pour les besoins plus poussés, un **mode avancé** donne accès aux « ensembles » de
filtres (vous pouvez en avoir plusieurs, mais un seul est actif à la fois), à
l'export/import d'un script au format Sieve brut, et à un éditeur de script en texte pour
qui connaît ce langage. Un script écrit à la main demande toujours une confirmation
(mot de passe ou code de double authentification) avant d'être enregistré.

::: details Si votre ancien webmail avait déjà des filtres
Si vous arrivez d'un autre webmail qui gérait déjà des filtres sur ce même serveur,
Colombe ne modifie jamais un script qu'il n'a pas créé : l'onglet vous le signale, et vous
pouvez soit le garder en mode avancé, soit créer un nouvel ensemble Colombe et l'activer
(l'ancien reste sur le serveur, simplement désactivé).
:::

## Réponse automatique

Utile en cas d'absence : activez-la, choisissez une période (du/au, facultatif), un objet
et un message. « Ne pas répondre plus d'une fois tous les… » évite de renvoyer la même
réponse en boucle à un expéditeur qui vous écrit plusieurs fois. Vous pouvez ajouter vos
autres adresses e-mail (pour que la réponse automatique s'applique aussi au courrier reçu
sur ces adresses, si votre configuration le permet).

La section **Message reçu** décide de ce qu'il advient du courrier pendant votre absence :
le garder (par défaut), le supprimer, le rediriger vers une autre adresse, ou en envoyer
une copie. Les deux derniers choix demandent une confirmation (voir plus bas).

## Transfert

Fait suivre automatiquement tous vos messages entrants vers une autre adresse, avec ou
sans en garder une copie dans votre boîte. Le transfert n'est autorisé que vers certains
domaines choisis par votre établissement — l'onglet les indique. Si votre adresse
personnelle n'en fait pas partie, demandez à votre établissement, ou consultez votre
messagerie professionnelle avec l'application de votre choix plutôt que de la faire
suivre : voir [Lire son courrier dans une autre application](/guide/autres-applications).

## Pourquoi une confirmation est-elle parfois demandée ?

Activer un transfert, une redirection, ou une action de notification dans un filtre
déclenche une demande de confirmation (votre mot de passe, ou votre code de double
authentification) avant l'enregistrement, puis un e-mail d'alerte vous informe du
changement et l'action s'inscrit dans votre [activité récente](/guide/securite). C'est
volontaire : une redirection silencieuse est justement ce qu'installe un attaquant qui a
volé un mot de passe, pour continuer à lire votre courrier après que vous l'ayez changé.
Si vous n'êtes pas à l'origine d'une alerte de ce type, changez votre mot de passe
immédiatement et prévenez votre établissement.
