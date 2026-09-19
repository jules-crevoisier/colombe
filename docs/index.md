---
layout: page
title: Colombe, le webmail libre des établissements
titleTemplate: false
description: Webmail libre (AGPL-3.0) pour les universités, écoles, collectivités et entreprises qui exploitent leur propre serveur Dovecot et Postfix. Remplace Roundcube sans toucher au serveur de messagerie. Sécurisé par défaut, sans aucune ressource externe.
sidebar: false
aside: false
pageClass: colombe-home
---

<ColombeLanding>
<template v-slot:install>

::: code-group

```bash [Docker]
mkdir -p /opt/colombe && cd /opt/colombe
# docker-compose.yml et colombe.env.example :
# dossier deploy/docker/ des sources
cp colombe.env.example colombe.env
chmod 600 colombe.env
$EDITOR colombe.env   # serveur, domaines, secrets
docker compose up -d
curl -s http://127.0.0.1:3000/api/health
```

```bash [Archive + systemd]
tar -xzf colombe-<version>.tar.gz -C /opt
mv /opt/colombe-<version> /opt/colombe && cd /opt/colombe
# Reprend la configuration de Roundcube,
# génère les secrets, teste les connexions
node scripts/colombe-setup.mjs \
  --from-roundcube /etc/roundcube/config.inc.php \
  --out /etc/colombe/colombe.env
node scripts/colombe-doctor.mjs \
  --env-file /etc/colombe/colombe.env
cp deploy/systemd/colombe.service /etc/systemd/system/
systemctl enable --now colombe
```

:::

</template>
<template v-slot:minimum>

```ini [colombe.env]
NODE_ENV=production
MAIL_HOST=mail.univ-exemple.fr
MAIL_DOMAINS=univ-exemple.fr
NUXT_SESSION_PASSWORD=<openssl rand -base64 32>
WEBMAIL_DATA_KEY=<openssl rand -base64 32, une autre>
WEBMAIL_DATA_DIR=/var/lib/colombe
```

</template>
</ColombeLanding>
