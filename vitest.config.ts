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
        },
      },
      {
        extends: true,
        test: {
          // Backend IMAP réel contre GreenMail (docker compose up -d greenmail)
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
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
