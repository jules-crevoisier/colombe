# Installer Colombe

Colombe est un webmail : il se connecte à **votre** serveur de messagerie (IMAP, SMTP,
et ManageSieve pour les filtres), exactement comme Roundcube. Il ne remplace ni Dovecot
ni Postfix et ne touche pas à leur configuration.

Deux façons de l'installer :

| | Docker | Archive + systemd |
|---|---|---|
| Prérequis | Docker (ou Podman) | Node.js 24 LTS |
| Mise à jour | `docker compose pull && docker compose up -d` | remplacer le dossier, redémarrer |
| Idéal pour | serveur applicatif séparé | installation sur le serveur de messagerie, à côté de Roundcube |

Dans les deux cas, un proxy inverse (Apache ou Nginx) assure le HTTPS. Les fichiers
d'exemple sont dans `deploy/`.

**Durée : 15 à 30 minutes.**

## 0. Avant de commencer

Vérifiez sur votre serveur de messagerie :

- IMAP en **TLS (993)** ou STARTTLS (143), SMTP de **soumission authentifiée** (587 ou 465) ;
- un certificat valide pour le nom utilisé (Colombe refuse les certificats non vérifiés) ;
- facultatif : **ManageSieve** (Dovecot Pigeonhole, port 4190) pour les filtres, la
  réponse automatique et le transfert ;
- `mail_max_userip_connections` de Dovecot (défaut 10) : chaque session Colombe ouverte
  garde une connexion IMAP (nouveaux messages en direct). Si Colombe tourne sur une autre
  machine, **toutes** les connexions viennent de son IP : augmentez la limite pour cette IP
  ou de manière globale (ex. `mail_max_userip_connections = 50`).

Il vous faut ensuite deux secrets, générés une fois pour toutes :

```bash
openssl rand -base64 32   # NUXT_SESSION_PASSWORD
openssl rand -base64 32   # WEBMAIL_DATA_KEY (une autre valeur ; à sauvegarder à part)
```

Le plus simple est de laisser l'assistant écrire la configuration (il génère les secrets,
teste les connexions et peut reprendre la configuration de Roundcube) :

```bash
node scripts/colombe-setup.mjs --from-roundcube /etc/roundcube/config.inc.php
```

Toutes les variables sont décrites dans [CONFIGURATION.md](CONFIGURATION.md).

## 1a. Installation avec Docker

```bash
mkdir -p /opt/colombe && cd /opt/colombe
# Récupérer deploy/docker/docker-compose.yml et deploy/docker/colombe.env.example
cp colombe.env.example colombe.env && chmod 600 colombe.env
$EDITOR colombe.env              # MAIL_HOST, MAIL_DOMAINS, les deux secrets…
docker compose up -d
docker compose logs -f colombe   # « Listening on http://0.0.0.0:3000 »
```

Le conteneur écoute sur `127.0.0.1:3000`, tourne sans privilèges, en lecture seule, et
garde ses données dans le volume `colombe-data` (`/data`). État de santé :
`docker inspect --format '{{.State.Health.Status}}' colombe`.

Pour construire l'image vous-même : `docker build -t colombe .` à la racine des sources.

## 1b. Installation avec l'archive (systemd)

1. **Node.js 24 LTS.** Debian 12 fournit Node 18, trop ancien. Utilisez l'archive
   officielle de nodejs.org (vérifiez la somme SHA-256) dans `/opt/node`, ou le dépôt
   NodeSource.
2. **Utilisateur et dossiers :**
   ```bash
   useradd --system --home /var/lib/colombe --shell /usr/sbin/nologin colombe
   install -d -o colombe -g colombe -m 700 /var/lib/colombe
   install -d -m 755 /etc/colombe
   ```
3. **Application :**
   ```bash
   tar -xzf colombe-<version>.tar.gz -C /opt
   mv /opt/colombe-<version> /opt/colombe
   sha256sum -c SHA256SUMS            # avec le fichier publié à côté de l'archive
   ```
4. **Configuration :**
   ```bash
   cd /opt/colombe
   node scripts/colombe-setup.mjs --out /etc/colombe/colombe.env
   chmod 600 /etc/colombe/colombe.env
   node scripts/colombe-doctor.mjs --env-file /etc/colombe/colombe.env
   ```
   Pour un proxy inverse sur la même machine : `HOST=127.0.0.1`, `PORT=3100`,
   `MAIL_TRUST_PROXY=true`, et `NUXT_APP_BASE_URL=/colombe/` si Colombe est publié dans
   un sous-dossier.
5. **Service :**
   ```bash
   cp deploy/systemd/colombe.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now colombe
   journalctl -u colombe -f
   ```
   Le service est durci (`ProtectSystem=strict`, `NoNewPrivileges`, écriture limitée à
   `/var/lib/colombe`). Si Node n'est pas dans `/usr/bin`, adaptez `ExecStart`.

## 2. Proxy inverse et HTTPS

- **Apache** : `deploy/apache/colombe.conf` (modules `proxy`, `proxy_http`, `headers`).
  ```bash
  cp deploy/apache/colombe.conf /etc/apache2/conf-available/
  a2enmod proxy proxy_http headers && a2enconf colombe
  apache2ctl configtest && systemctl reload apache2
  ```
- **Nginx** : `deploy/nginx/colombe.conf`, à inclure dans le bloc `server` HTTPS existant.

Les deux fichiers publient Colombe sous `/colombe/`, désactivent la mise en tampon pour
les nouveaux messages en direct (`/api/events`) et contiennent, en commentaire, la
redirection de l'ancienne adresse de Roundcube vers Colombe.

Vérification : `curl -s https://mail.univ-exemple.fr/colombe/api/health` →
`{"status":"ok","version":"…"}`.

## 3. Configuration automatique des logiciels de messagerie (facultatif)

Pour que Thunderbird et Outlook trouvent seuls les réglages quand un utilisateur saisit
son adresse :

1. DNS : `autoconfig.univ-exemple.fr` et `autodiscover.univ-exemple.fr` → votre serveur
   web (enregistrements A/AAAA ou CNAME).
2. Certificat couvrant ces deux noms (Outlook exige HTTPS).
3. `deploy/apache/autoconfig.conf` ou `deploy/nginx/autoconfig.conf`.
4. `MAIL_PUBLIC_HOST` renseigné si Colombe se connecte à `localhost`.

Test : `curl https://autoconfig.univ-exemple.fr/mail/config-v1.1.xml`.

Les iPhone et iPad n'utilisent pas ce mécanisme : les utilisateurs téléchargent leur
profil depuis **Paramètres → Autres applications**.

## 4. Protection contre les attaques par mot de passe (fail2ban)

Colombe limite déjà les tentatives (5 par compte et 30 par IP en 15 minutes) et écrit
une ligne par échec :

```
[colombe] auth-failure ip=203.0.113.7 user=jean.dupont@univ-exemple.fr
```

Filtre et prison fournis : `deploy/fail2ban/`. Derrière un proxy, l'IP n'est juste que si
`MAIL_TRUST_PROXY=true`.

## 5. Sauvegardes

À sauvegarder :

- le dossier de données (`/var/lib/colombe` ou le volume `colombe-data`) : base SQLite
  des préférences, contacts, identités, réponses types et double authentification ;
- **à part**, `WEBMAIL_DATA_KEY` : sans elle, les secrets de double authentification
  sont illisibles.

Copie cohérente à chaud : `sqlite3 /var/lib/colombe/webmail.sqlite ".backup /sauvegarde/colombe.sqlite"`.

Le courrier lui-même reste sur le serveur IMAP : Colombe n'en garde aucune copie.

## 6. Mise à jour

```bash
# Archive
tar -xzf colombe-<nouvelle>.tar.gz -C /opt
mv /opt/colombe /opt/colombe.prev && mv /opt/colombe-<nouvelle> /opt/colombe
systemctl restart colombe
# Retour arrière : inverser les deux dossiers et redémarrer.

# Docker
docker compose pull && docker compose up -d
```

La base est migrée automatiquement au démarrage. Un redémarrage déconnecte les
utilisateurs (les sessions sont en mémoire) : préférez un moment calme.

## Et ensuite

- Reprendre les contacts, identités et réponses types de Roundcube :
  [MIGRATION-ROUNDCUBE.md](MIGRATION-ROUNDCUBE.md).
- Sécurité, ce que Colombe fait et ne fait pas : [SECURITE.md](SECURITE.md).
