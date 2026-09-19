/**
 * GET /api/health : sonde de disponibilité (Docker HEALTHCHECK, systemd,
 * répartiteur de charge). Sans authentification, sans information interne.
 */
import { describe, expect, inject, it } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }

const base = inject('apiBase')

describe('GET /api/health', () => {
  it('répond 200 avec le statut et la version, sans authentification', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const body = await res.json() as Record<string, unknown>
    expect(body).toEqual({ status: 'ok', version: pkg.version })
  })

  it('ne révèle aucune information interne (hôte, port, compteur)', async () => {
    const res = await fetch(`${base}/api/health`)
    const text = await res.text()
    expect(text.toLowerCase()).not.toMatch(/host|port|imap|smtp|count/)
  })
})
