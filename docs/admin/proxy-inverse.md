# Proxy inverse et HTTPS

Colombe n'écoute qu'en HTTP, en local (`127.0.0.1` recommandé). Un reverse proxy Apache
ou Nginx assure le HTTPS public, et c'est aussi lui qui gère un éventuel sous-chemin.
Fichiers d'exemple complets dans `deploy/apache/` et `deploy/nginx/`.

## Apache

Modules requis : `proxy`, `proxy_http`, `headers`.

```bash
cp deploy/apache/colombe.conf /etc/apache2/conf-available/
a2enmod proxy proxy_http headers && a2enconf colombe
apache2ctl configtest && systemctl reload apache2
```

À inclure dans un `VirtualHost :443` déjà configuré en TLS — le fichier fourni ne définit
pas le VirtualHost lui-même.

## Nginx

`deploy/nginx/colombe.conf`, à inclure dans le bloc `server { }` HTTPS existant.

## Racine ou sous-chemin

Les deux fichiers fournis publient Colombe sous `/colombe/`. Pour changer :

1. Adaptez le chemin dans le fichier du proxy (`ProxyPass`/`location`).
2. `NUXT_APP_BASE_URL=/colombe/` (ou le chemin choisi), **avec la barre finale** —
   lu au runtime par Nuxt lui-même, aucune recompilation nécessaire pour changer de
   chemin.

::: warning Git Bash sous Windows
Sur un poste de développement Windows avec Git Bash, une valeur comme `/colombe/` passée
dans une variable d'environnement peut être réinterprétée comme un chemin de fichier
Windows (conversion automatique de MSYS). Voir
[Dépannage](/admin/depannage#nuxt-app-base-url-deforme-sous-git-bash-windows).
:::

## Nouveaux messages en direct (SSE)

Les nouveaux messages en direct utilisent un flux `text/event-stream` sur
`/api/events`, une connexion HTTP qui reste ouverte. Un proxy qui **met en tampon** cette
route la casse silencieusement (le navigateur ne reçoit rien avant la coupure de
connexion) : les deux fichiers fournis désactivent explicitement la mise en tampon pour ce
chemin précis.

- Apache : `flushpackets=on timeout=3600` sur `ProxyPass /colombe/api/events`.
- Nginx : `proxy_buffering off; proxy_read_timeout 3600s;` sur
  `location /colombe/api/events`.

Si vous personnalisez la configuration, gardez cette exception : sans elle, l'indicateur
de nouveaux messages ne se met plus à jour sans recharger la page.

## HTTPS

Colombe lui-même ne gère pas les certificats : c'est le rôle du proxy (Let's Encrypt ou
certificat de l'établissement). Colombe applique cependant `Strict-Transport-Security` et
d'autres en-têtes de sécurité qui supposent une connexion en HTTPS de bout en bout — voir
[Sécurité](/admin/securite).

## `MAIL_TRUST_PROXY`

Derrière un reverse proxy, Colombe ne voit par défaut que l'IP du proxy pour chaque
requête (journal des connexions, limitation des tentatives, fail2ban). `MAIL_TRUST_PROXY=true`
fait lire la dernière valeur de l'en-tête `X-Forwarded-For` à la place — **uniquement**
sûr si Colombe n'est **joignable que** par ce proxy (`HOST=127.0.0.1`, jamais exposé
directement). Les deux fichiers fournis positionnent `X-Forwarded-Proto`/`X-Forwarded-For`
en conséquence ; activez la variable côté Colombe pour qu'elle en tienne compte. Voir
[Configuration, §Données, sessions, réseau](/admin/configuration#donnees-sessions-reseau).

## Taille des pièces jointes

La limite applicative (`COLOMBE_MAX_ATTACHMENTS_MB`, 10 Mo par défaut) doit rester
**sous** ce que le proxy accepte en taille de corps de requête :

- Nginx : `client_max_body_size` (le fichier fourni utilise `20m`, une marge au-dessus de
  la limite par défaut pour l'enveloppe multipart et le codage base64 des pièces jointes,
  qui ajoute environ 35 % à leur taille).
- Apache : pas de limite par défaut ; `LimitRequestBody` si vous en avez fixé une
  ailleurs, à ajuster de la même façon.

Pensez aussi à `message_size_limit` de Postfix, qui doit rester au-dessus de
`COLOMBE_MAX_ATTACHMENTS_MB` (avec la même marge), sans quoi un message accepté par
Colombe pourrait être rejeté à l'envoi.

## Vérification

```bash
curl -s https://mail.univ-exemple.fr/colombe/api/health
# {"status":"ok","version":"…"}
```
