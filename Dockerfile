# Colombe — image de production.
# Deux étapes : build (dépendances de développement, compilation Nuxt) puis
# exécution (uniquement .output/, les scripts d'administration et un
# utilisateur non privilégié). Voir aussi scripts/build-release.mjs pour
# l'archive de release destinée à une installation systemd/Apache/Nginx.

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Corepack lit le champ "packageManager" de package.json et installe cette
# version exacte de pnpm au premier appel : pas de version codée en dur ici.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Scripts d'installation ignorés ici : le postinstall (`nuxt prepare`) a besoin des
# sources, copiées juste après. Cette étape seule reste en cache tant que le
# lockfile ne change pas.
RUN pnpm fetch --frozen-lockfile

COPY . .
RUN pnpm install --frozen-lockfile --offline

# Aucun secret ni variable MAIL_*/NUXT_*/WEBMAIL_*/COLOMBE_* n'est fourni à cette
# étape : le build ne doit dépendre d'aucune configuration d'exécution (une
# seule image sert n'importe quel établissement, configuré au démarrage du
# conteneur via des variables d'environnement — voir server/lib/config/index.ts).
RUN pnpm build


FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEBMAIL_DATA_DIR=/data

# Sortie applicative de Nuxt (server Nitro + assets publics).
COPY --from=build /app/.output/ ./

# Scripts d'administration (setup, doctor, import Roundcube) : copiés en gros
# puis élagués des fichiers réservés au poste de développement. Tolérant à
# l'absence de certains d'entre eux (écrits par ailleurs).
COPY --from=build /app/scripts/ ./scripts/
RUN rm -f ./scripts/with-build-lock.mjs ./scripts/deploy-ssh.sh ./scripts/check-deploy-secrets.mjs

# Les scripts d'administration importent directement la configuration runtime
# (TypeScript exécuté nativement par Node 24, sans étape de compilation) : le
# fichier source doit exister au même chemin relatif que dans le dépôt.
COPY --from=build /app/server/lib/config/index.ts ./server/lib/config/index.ts
COPY --from=build /app/server/lib/store/db.ts ./server/lib/store/db.ts
COPY --from=build /app/server/lib/contacts/vcard.ts ./server/lib/contacts/vcard.ts

# Utilisateur système dédié, sans privilèges, uid/gid fixes (portable entre hôtes).
RUN groupadd --gid 10001 colombe \
 && useradd --uid 10001 --gid colombe --home-dir /app --no-create-home --shell /usr/sbin/nologin colombe \
 && mkdir -p /data \
 && chown -R colombe:colombe /app /data

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.NUXT_APP_BASE_URL||'/')+'api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

USER colombe
CMD ["node", "server/index.mjs"]
