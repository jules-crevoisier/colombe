# Installation par archive (systemd)

Installe Colombe depuis l'archive de release (`colombe-<version>.tar.gz`), en service
systemd, typiquement directement sur le serveur de messagerie, à côté d'un Roundcube
existant pendant la transition. Durée : 15 à 30 minutes.

## 0. Avant de commencer

Mêmes prérequis serveur que pour Docker : IMAP TLS/STARTTLS, SMTP de soumission
authentifiée, certificat valide, ManageSieve facultatif — voir
[Installation Docker, §0](/admin/installation-docker#0-avant-de-commencer). Générez les
deux secrets :

```bash
openssl rand -base64 32   # NUXT_SESSION_PASSWORD
openssl rand -base64 32   # WEBMAIL_DATA_KEY (une autre valeur)
```

## 1. Node.js 24

Debian 12 (et la plupart des distributions stables) fournissent une version de Node trop
ancienne pour `node:sqlite`. Utilisez l'archive officielle de nodejs.org (en vérifiant la
somme SHA-256) installée à part, par exemple dans `/opt/node`, ou le dépôt NodeSource.

## 2. Utilisateur et dossiers

```bash
useradd --system --home /var/lib/colombe --shell /usr/sbin/nologin colombe
install -d -o colombe -g colombe -m 700 /var/lib/colombe
install -d -m 755 /etc/colombe
```

## 3. Application

```bash
tar -xzf colombe-<version>.tar.gz -C /opt
mv /opt/colombe-<version> /opt/colombe
sha256sum -c SHA256SUMS            # avec le fichier publié à côté de l'archive
```

L'archive contient la sortie de build Nuxt (`server/`, `public/`), les scripts
d'administration (`scripts/`), les fichiers de déploiement (`deploy/`) et cette
documentation — voir [Contribuer, §Publier une version](/contribuer#publier-une-version)
pour comment elle est produite (`pnpm release`).

## 4. Configuration

Le plus simple : laisser l'assistant l'écrire (il génère les secrets, sonde les
connexions, et peut reprendre la configuration d'un Roundcube existant) :

```bash
cd /opt/colombe
node scripts/colombe-setup.mjs --from-roundcube /etc/roundcube/config.inc.php --out /etc/colombe/colombe.env
chmod 600 /etc/colombe/colombe.env
node scripts/colombe-doctor.mjs --env-file /etc/colombe/colombe.env
```

Sans Roundcube à reprendre : `node scripts/colombe-setup.mjs --out /etc/colombe/colombe.env`
(mode interactif s'il est lancé dans un terminal, ou entièrement piloté par options — voir
`--help`).

Pour un proxy inverse sur la même machine : `HOST=127.0.0.1`, `PORT=3100`,
`MAIL_TRUST_PROXY=true`, et `NUXT_APP_BASE_URL=/colombe/` si Colombe est publié dans un
sous-dossier. Référence complète des variables : [Configuration](/admin/configuration).

## 5. Service systemd

```bash
cp deploy/systemd/colombe.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now colombe
journalctl -u colombe -f
```

Le service fourni est durci : `ProtectSystem=strict`, `NoNewPrivileges=true`, écriture
limitée à `/var/lib/colombe`, capacités Linux et appels système restreints. Si Node n'est
pas accessible via `/usr/bin/env node` (installation dans `/opt/node` par exemple),
adaptez la ligne `ExecStart` du fichier de service en conséquence.

## 6. Et ensuite

- [Proxy inverse](/admin/proxy-inverse) : HTTPS public.
- [Configuration automatique des logiciels de messagerie](/admin/configuration-automatique)
  (facultatif).
- [Protection fail2ban](/admin/securite#recommandations).
- [Exploitation](/admin/exploitation) : sauvegardes, mises à jour, supervision.
- Reprendre les données d'un Roundcube existant :
  [Migration depuis Roundcube](/admin/migration-roundcube).
