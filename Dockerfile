# Colombe — image de production.
# Deux étapes : build (dépendances de développement, compilation Nuxt) puis
# exécution (uniquement .output/, les scripts d'administration et un
# utilisateur non privilégié). Voir aussi scripts/build-release.mjs pour
# l'archive de release destinée à une installation systemd/Apache/Nginx.

# Étape de build sur l'architecture de la MACHINE de build ($BUILDPLATFORM), jamais
# émulée : la sortie Nitro est du JavaScript pur (aucun module natif, `node:sqlite` est
# intégré à Node), identique pour amd64 et arm64. Seule l'étape finale est par
# architecture. Sans cela, l'image arm64 se construit sous QEMU en plus d'une heure.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app

# Corepack lit le champ "packageManager" de package.json et installe cette
# version exacte de pnpm au premier appel : pas de version codée en dur ici.
RUN corepack enable
# Emplacement du store fixé explicitement (plutôt que de compter sur le
# défaut XDG de l'image de base) : rend le chemin du montage de cache
# ci-dessous prévisible et indépendant de la variante Node utilisée.
RUN pnpm config set store-dir /pnpm-store --global

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Scripts d'installation ignorés ici : le postinstall (`nuxt prepare`) a besoin des
# sources, copiées juste après. Cette étape seule reste en cache tant que le
# lockfile ne change pas. Montage de cache BuildKit en plus (accélère les builds
# locaux répétés) ; `pnpm fetch` reste la couche qui protège le cache Docker en
# CI, où le cache de store pnpm ci-dessous peut être froid (voir ci.yml, cache
# GitHub Actions type=gha : il couvre aussi les montages --mount=type=cache).
RUN --mount=type=cache,id=colombe-pnpm-store,target=/pnpm-store \
    pnpm fetch --frozen-lockfile

COPY . .
RUN --mount=type=cache,id=colombe-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --offline

# Aucun secret ni variable MAIL_*/NUXT_*/WEBMAIL_*/COLOMBE_* n'est fourni à cette
# étape : le build ne doit dépendre d'aucune configuration d'exécution (une
# seule image sert n'importe quel établissement, configuré au démarrage du
# conteneur via des variables d'environnement — voir server/lib/config/index.ts).
RUN pnpm build

# Élagage des fichiers réservés au poste de développement, fait ici (l'étape
# d'exécution ci-dessous n'a pas de shell pour le faire elle-même) :
# with-build-lock/deploy-ssh.sh/check-deploy-secrets ne servent qu'au dépôt source ;
# build-release.mjs (archive tar.gz) n'a pas sa place dans l'image non plus.
RUN rm -f ./scripts/with-build-lock.mjs ./scripts/deploy-ssh.sh \
       ./scripts/check-deploy-secrets.mjs ./scripts/build-release.mjs

# Répertoire de données (volume /data) : simple dossier vide à copier dans
# l'étape finale (avec --chown, voir plus bas) pour qu'un volume nommé
# fraîchement créé par Docker hérite des bonnes permissions. Créé ici parce
# que l'étape finale n'a ni shell ni coreutils pour faire un `mkdir` elle-même.
RUN mkdir -p /data-empty

# Vérification (documentée, pas exécutée en CI faute de moteur Docker local ici) :
# `find /app/.output/server/node_modules -name '*.node'` doit rester vide.
# Confirmé lors de l'écriture de ce Dockerfile : aucune dépendance native dans
# .output — imapflow/nodemailer/mailparser/dompurify sont du JS pur, et
# node:sqlite (server/lib/store/db.ts) est intégré au binaire Node lui-même
# (pas de liaison à une libsqlite3 du système), donc indépendant de la libc de
# l'image d'exécution (glibc/musl/distroless).


# --- Exécution -------------------------------------------------------------
# Choix de base : gcr.io/distroless/nodejs24-debian12:nonroot.
#
# Comparé (poids de l'image de base seule, manifeste amd64, compressé,
# mesuré sur le registre au moment de l'écriture) :
#   - node:24-bookworm-slim (précédent choix) : 77,1 Mo, shell + coreutils + apt
#   - node:24-alpine                          : 58,8 Mo, shell + apk (musl)
#   - gcr.io/distroless/nodejs24-debian12:nonroot : 50,3 Mo, AUCUN shell,
#     aucun gestionnaire de paquets, uid non privilégié déjà configuré
# Image finale attendue (base + .output/ 26 Mo non compressés + scripts) :
# de l'ordre de 60-65 Mo compressés.
#
# Le choix distroless est possible ici précisément parce qu'aucune dépendance
# native n'existe (voir ci-dessus) : rien à compiler contre la libc de l'image,
# rien à installer avec apt/apk au runtime. Sans shell, deux usages documentés
# dans le brief restent à vérifier :
#   - HEALTHCHECK : la forme exec (CMD ["node", "-e", ...]) n'invoque aucun
#     shell (contrairement à la forme chaîne) — fonctionne à l'identique.
#   - Scripts d'admin (`docker compose exec colombe node scripts/...`) :
#     `docker exec`/`compose exec` exécute directement le binaire donné, sans
#     passer par ENTRYPOINT ni par un shell — fonctionne à l'identique.
# La variante "nonroot" fixe l'utilisateur à uid/gid 65532 (au lieu des
# 10001 d'un Dockerfile Debian/Alpine classique) : c'est l'utilisateur
# "nonroot" standard des images distroless, non personnalisable sans repartir
# d'une base avec shell. Documenté ici comme demandé.
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEBMAIL_DATA_DIR=/data \
    PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin

ARG IMAGE_VERSION=0.0.0-dev
ARG IMAGE_REVISION=unknown
ARG IMAGE_SOURCE=https://github.com/jules-crevoisier/colombe
LABEL org.opencontainers.image.title="Colombe" \
      org.opencontainers.image.description="Webmail moderne et sécurisé pour établissements (remplaçant de RainLoop/Roundcube)." \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}"

# Sortie applicative de Nuxt (server Nitro + assets publics), scripts
# d'administration déjà élagués ci-dessus, et les 3 fichiers TypeScript que
# ces scripts importent directement (Node 24 les exécute nativement, sans
# étape de compilation : le chemin relatif doit rester identique au dépôt).
COPY --from=build /app/.output/ ./
COPY --from=build /app/scripts/ ./scripts/
COPY --from=build /app/server/lib/config/index.ts ./server/lib/config/index.ts
COPY --from=build /app/server/lib/store/db.ts ./server/lib/store/db.ts
COPY --from=build /app/server/lib/contacts/vcard.ts ./server/lib/contacts/vcard.ts

# Répertoire de données : --chown explicite (uid/gid 65532, l'utilisateur non
# privilégié de la variante "nonroot"), pour ne pas dépendre de la manière dont
# COPY traite les métadonnées d'un répertoire copié depuis une autre étape.
COPY --from=build --chown=65532:65532 /data-empty /data

VOLUME ["/data"]
EXPOSE 3000

# PID 1 sans tini/dumb-init : vérifié dans le code généré par Nitro
# (.output/server/chunks/_/nitro.mjs, cf. NITRO_SHUTDOWN_SIGNALS) que le
# préréglage node-server installe lui-même un gestionnaire SIGTERM/SIGINT
# (via une bibliothèque d'arrêt propre, "graceful shutdown", timeout 30 s,
# `forceExit` par défaut) — ce qui suffit à répondre correctement même en
# tant que PID 1 : le problème usuel de PID 1 (dispositions par défaut du
# noyau non appliquées) ne concerne que les signaux SANS gestionnaire
# explicite. `docker stop` doit donc rester rapide (pas d'attente des 10 s de
# grâce) sans avoir besoin d'empaqueter tini, absent de toute façon de cette
# image distroless (pas de shell pour l'installer autrement qu'en copiant un
# binaire statique, inutile ici).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.NUXT_APP_BASE_URL||'/')+'api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Pas de USER ici : la variante "nonroot" de l'image distroless configure déjà
# l'utilisateur non privilégié (65532:65532) — le redéfinir serait redondant.
# Pas d'ENTRYPOINT ici non plus : celui de l'image de base est déjà
# ["node"] (documenté par le projet distroless), donc CMD ne fournit que
# l'argument, exactement comme "node server/index.mjs".
CMD ["server/index.mjs"]
