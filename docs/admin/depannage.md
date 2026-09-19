# Dépannage

Problèmes courants au déploiement, avec les messages exacts que Colombe affiche et de quoi
partir pour les corriger.

## Colombe refuse de démarrer

Colombe valide **toute** sa configuration avant d'écouter la moindre requête ; si quoi que
ce soit manque ou est incohérent, il l'écrit sur la sortie d'erreur et s'arrête
immédiatement (`process.exit(1)`), sans jamais laisser tourner un webmail à moitié
configuré. Exemple :

```
Configuration invalide :
  - MAIL_DOMAINS est obligatoire : le ou les domaines des adresses de l'établissement (ex. univ-exemple.fr).
  - WEBMAIL_DATA_KEY doit contenir au moins 32 caractères (openssl rand -base64 32), différente de NUXT_SESSION_PASSWORD.
```

La liste est **complète** (toutes les erreurs trouvées, pas seulement la première).
Corrigez chaque ligne dans votre fichier d'environnement, puis relancez
`node scripts/colombe-doctor.mjs` pour vérifier avant de redémarrer le service. Référence
de chaque variable : [Configuration](/admin/configuration).

## La connexion échoue alors que le mot de passe est correct

- Vérifiez `MAIL_LOGIN_USERNAME` : si votre serveur authentifie par identifiant seul
  (`localpart`) et que Colombe est configuré en `email` (ou l'inverse), l'authentification
  IMAP/SMTP échoue silencieusement côté Colombe (message générique « Adresse ou mot de
  passe incorrect » côté utilisateur, sans plus de détail — volontaire, pour ne pas
  renseigner un attaquant sur la cause exacte).
- `node scripts/colombe-doctor.mjs --user <adresse> --password-stdin` reproduit
  l'authentification réelle (IMAP LOGIN + SMTP AUTH) et affiche le refus exact renvoyé par
  le serveur.
- Vérifiez que l'adresse appartient bien à un domaine de `MAIL_DOMAINS` : un domaine non
  listé est refusé avant même de contacter le serveur de messagerie.

## Certificat TLS : connexion refusée ou nom ne correspondant pas

`colombe-doctor` sonde chaque service et rapporte, par exemple :

```
! imap : le certificat (mail.univ-exemple.fr, SAN: mail.univ-exemple.fr) ne couvre pas 127.0.0.1.
! imap : chaîne de certification non validée (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
```

- **Le nom ne correspond pas** (`ne couvre pas`) : fréquent quand Colombe se connecte en
  `localhost`/`127.0.0.1` alors que le certificat est émis pour le nom public. Définissez
  `MAIL_TLS_SERVERNAME` (et `MAIL_SIEVE_TLS_SERVERNAME` si ManageSieve est concerné) avec
  le nom exact présent dans le certificat — Colombe l'utilisera pour le SNI et la
  vérification, tout en se connectant toujours à l'hôte/IP configuré.
- **Chaîne non validée** : certificat auto-signé ou autorité non reconnue. En production,
  corrigez le certificat (Let's Encrypt ou l'autorité de votre établissement) —
  `MAIL_TLS_REJECT_UNAUTHORIZED=false` est **refusé** en production sauf dérogation
  explicite (`WEBMAIL_ALLOW_INSECURE_TLS=1`, réservée aux tests, jamais sur un
  établissement réel).

## Filtres indisponibles (ManageSieve)

Les onglets Filtres, Réponse automatique et Transfert affichent simplement « Les filtres
ne sont pas disponibles sur ce serveur. » quand la connexion ManageSieve échoue ou que
`MAIL_SIEVE_ENABLED=false`. Rien d'autre n'est affecté : le reste de la messagerie
continue de fonctionner normalement. Vérifiez `MAIL_SIEVE_HOST`/`MAIL_SIEVE_PORT` (défaut
4190) et que `dovecot-managesieved` écoute bien à cette adresse ;
`node scripts/colombe-doctor.mjs` sonde ce port comme les autres.

## Nouveaux messages non « en direct » derrière un proxy

Si les nouveaux messages n'apparaissent qu'après avoir rechargé la page, le proxy met
probablement en tampon le flux `/api/events` (SSE). Voir
[Proxy inverse, §Nouveaux messages en direct](/admin/proxy-inverse#nouveaux-messages-en-direct-sse)
pour la configuration exacte à vérifier (`proxy_buffering off` en Nginx,
`flushpackets=on` en Apache).

## 403 « Origine refusée » derrière un proxy

Colombe compare l'en-tête `Origin` (ou `Referer` à défaut) de chaque requête qui modifie
des données à l'hôte de la requête, en tenant compte de `X-Forwarded-Host` — une
protection CSRF complémentaire au cookie `SameSite=Lax`. Si ce contrôle rejette des
requêtes légitimes derrière votre proxy :

- Vérifiez que le proxy transmet un en-tête `Host` cohérent avec le nom public utilisé par
  les navigateurs (et `X-Forwarded-Host` s'il réécrit `Host`).
- Un mélange de noms d'accès (ex. certains utilisateurs arrivant par une ancienne adresse
  encore active) peut déclencher ce refus : uniformisez sur un seul nom public.

## Pièces jointes trop volumineuses

Message côté interface : « Pièces jointes trop volumineuses (*N* Mo max.) », où *N* est
`COLOMBE_MAX_ATTACHMENTS_MB` (10 par défaut). Le serveur applique une marge (×1,5) par
rapport à la limite annoncée au navigateur, pour absorber le surcoût du codage base64 ; au
besoin, augmentez `COLOMBE_MAX_ATTACHMENTS_MB` **et** la limite de taille de corps de
requête du reverse proxy (`client_max_body_size` en Nginx) **et** `message_size_limit` de
Postfix en conséquence — voir
[Proxy inverse, §Taille des pièces jointes](/admin/proxy-inverse#taille-des-pieces-jointes).

## `NUXT_APP_BASE_URL` déformé sous Git Bash (Windows)

Sur un poste de développement ou de déploiement Windows utilisant Git Bash (MSYS), une
valeur comme `/colombe/` passée à une commande ou dans une variable d'environnement peut
être automatiquement réinterprétée comme un chemin de fichier Windows (ex.
`C:/Program Files/Git/colombe/`), ce qui casse silencieusement le sous-chemin de
publication. Deux options :

- désactiver la conversion pour la commande concernée :
  `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` (voir `scripts/deploy-ssh.sh`, qui le fait
  déjà pour son propre usage) ;
- définir `NUXT_APP_BASE_URL` directement dans le fichier d'environnement plutôt que sur
  la ligne de commande, ce qui évite entièrement le problème.

`colombe-doctor` signale (`!`) un `NUXT_APP_BASE_URL` qui ne se termine pas par `/`, un
symptôme possible de cette déformation.

## Voir aussi

- [Configuration](/admin/configuration) — référence de chaque variable
- [Exploitation](/admin/exploitation) — journaux, `colombe-doctor`, supervision
- [Sécurité](/admin/securite)
