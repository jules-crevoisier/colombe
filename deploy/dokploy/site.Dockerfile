# Site vitrine de Colombe (VitePress, docs/) pour le stack de démo Dokploy —
# voir docker-compose.yml (service "site") et README.md.
#
# Deux étapes : build (Node 24 + pnpm, `pnpm docs:build`) puis service statique
# minimal. Contexte de build : la racine du dépôt (../.. depuis ce fichier),
# comme pour le Dockerfile principal — voir le fichier
# deploy/dokploy/site.Dockerfile.dockerignore associé (remplace le
# .dockerignore racine pour CETTE image : celui-ci exclut tout "docs/", dont
# ce build a justement besoin — voir la doc Docker sur les fichiers
# d'exclusion propres à un Dockerfile).
#
# Choix du serveur statique : Caddy (caddy:2-alpine) plutôt que
# nginx-unprivileged. Aucune des deux options ne fait de HTTPS automatique ici
# (Traefik/Dokploy s'en charge déjà) : le critère est donc la simplicité de
# configuration pour ce cas précis (URLs "propres" VitePress + compression +
# en-têtes de sécurité). Caddy l'emporte : gzip ET zstd intégrés sans module
# supplémentaire, et "try_files {path} {path}.html {path}/ =404" exprime en
# une ligne exactement la règle des URLs propres de VitePress — l'équivalent
# nginx demande un bloc "location / { try_files ... }" plus verbeux pour un
# résultat identique. Alpine (donc un shell) est nécessaire de toute façon
# pour créer l'utilisateur non privilégié ci-dessous : pas de gain à chercher
# une variante distroless ici (le site n'a pas les mêmes contraintes de
# surface d'attaque que l'application, qui gère des identifiants).

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
RUN pnpm config set store-dir /pnpm-store --global

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=colombe-site-pnpm-store,target=/pnpm-store \
    pnpm fetch --frozen-lockfile

COPY . .
RUN --mount=type=cache,id=colombe-site-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --offline

# Adresses lues au build par docs/.vitepress/config.mts (bouton « Essayer la démo »,
# liens vers le dépôt, image de partage et sitemap). Aucun secret.
ARG COLOMBE_DEMO_URL
ARG COLOMBE_SITE_URL
ARG COLOMBE_REPO_URL=https://github.com/jules-crevoisier/colombe
ENV COLOMBE_DEMO_URL=${COLOMBE_DEMO_URL} \
    COLOMBE_SITE_URL=${COLOMBE_SITE_URL} \
    COLOMBE_REPO_URL=${COLOMBE_REPO_URL}
RUN pnpm docs:build
RUN test -f docs/.vitepress/dist/index.html || \
    (echo "docs/.vitepress/dist/index.html introuvable après 'pnpm docs:build'" >&2 && exit 1)


FROM caddy:2-alpine AS runtime
# Utilisateur non privilégié, uid/gid fixe 10001 (même convention que le
# Dockerfile principal). Caddy écoute sur :8080 (port non privilégié). Le binaire
# de l'image officielle porte la capability fichier cap_net_bind_service : avec
# cap_drop ALL et no-new-privileges (docker-compose.yml), le noyau refuse alors de
# l'exécuter (« operation not permitted »). Elle est inutile ici : on la retire.
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap
RUN addgroup -g 10001 site \
 && adduser -D -u 10001 -G site -h /srv/site -s /sbin/nologin site
WORKDIR /srv/site
COPY --from=build --chown=site:site /app/docs/.vitepress/dist ./
COPY --chown=site:site deploy/dokploy/Caddyfile /etc/caddy/Caddyfile

USER site
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
