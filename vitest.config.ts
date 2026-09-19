import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const shared = fileURLToPath(new URL('./shared', import.meta.url))
const app = fileURLToPath(new URL('./app', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': shared,
      '~': app,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          // getConfig() (limites, domaines) sans serveur de messagerie réel.
          env: { MAIL_BACKEND: 'mock' },
        },
      },
      {
        extends: true,
        test: {
          // Backend IMAP réel contre GreenMail (docker compose up -d greenmail)
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/filters.dovecot.test.ts', 'tests/integration/sso.dovecot.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          // Filtres Sieve contre Dovecot + Pigeonhole réel (docker compose up -d dovecot).
          // Serveur Nitro construit démarré par le fichier lui-même (beforeAll/afterAll) —
          // voir tests/integration/filters.dovecot.test.ts. Lancer via `pnpm test:dovecot`
          // (construit .output d'abord, comme test:api).
          name: 'integration-dovecot',
          include: ['tests/integration/filters.dovecot.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          // Connexion unique OIDC contre Keycloak + Dovecot 2.4 (oauth2) + Mailpit réels :
          // docker compose -f docker-compose.sso.yml up -d --wait, puis `pnpm test:sso`
          // (construit .output d'abord : le fichier démarre aussi un serveur Colombe).
          name: 'integration-sso',
          include: ['tests/integration/sso.dovecot.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          // Serveur Nuxt construit (.output), backend mémoire — voir tests/api/global-setup.ts
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/api/global-setup.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
