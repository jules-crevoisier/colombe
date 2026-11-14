/**
 * Fichier d'état du serveur mail (etat.json, écrit par le script de
 * surveillance) : validation et lecture sur disque.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parseServerStatus } from '../../../server/lib/server-status/schema'
import { MAX_STATUS_BYTES, readServerStatus } from '../../../server/lib/server-status'

const fixturePath = new URL('../../fixtures/etat-serveur.json', import.meta.url)
const fixture = (): Record<string, unknown> => JSON.parse(readFileSync(fixturePath, 'utf8'))

describe('parseServerStatus', () => {
  it('accepte le fichier réel du serveur', () => {
    const status = parseServerStatus(fixture())
    expect(status).not.toBeNull()
    expect(status?.global).toBe('attention')
    expect(status?.services).toHaveLength(8)
    expect(status?.services[0]).toMatchObject({ id: 'postfix@-', nom: 'Postfix', actif: true })
    expect(status?.file?.mis_de_cote).toBe(19)
    expect(status?.comptes).toMatchObject({ total: 348, bloques: 336, actifs: 12 })
    expect(status?.activite?.heures).toHaveLength(24)
    expect(status?.delivrabilite?.listes.find(l => l.nom === 'b.barracudacentral.org')).toEqual({ nom: 'b.barracudacentral.org', statut: 'listee', code: '127.0.0.2' })
    expect(status?.systeme?.certificat?.jours).toBe(76)
    expect(status?.intervalle_minutes).toBe(15)
  })

  it('refuse un contenu sans en-tête valide', () => {
    expect(parseServerStatus(null)).toBeNull()
    expect(parseServerStatus('texte')).toBeNull()
    const { services: _services, ...sansServices } = fixture()
    expect(parseServerStatus(sansServices)).toBeNull()
    expect(parseServerStatus({ ...fixture(), global: 'inconnu' })).toBeNull()
    expect(parseServerStatus({ ...fixture(), genere_le: 42 })).toBeNull()
  })

  it('un bloc secondaire absent ou cassé vaut null, le reste est conservé', () => {
    const { file: _file, ...sansFile } = fixture()
    const sansBloc = parseServerStatus(sansFile)
    expect(sansBloc).not.toBeNull()
    expect(sansBloc?.file).toBeNull()

    const casse = parseServerStatus({ ...fixture(), comptes: 'cassé', activite: { heures: 'non' }, fail2ban: null })
    expect(casse).not.toBeNull()
    expect(casse?.comptes).toBeNull()
    expect(casse?.activite).toBeNull()
    expect(casse?.fail2ban).toBeNull()
    expect(casse?.services).toHaveLength(8)
  })

  it('valeurs par défaut pour les champs facultatifs', () => {
    const { points_attention: _p, evenements: _e, serveur: _s, dernier_rapport: _d, intervalle_minutes: _i, ...minimal } = fixture()
    const status = parseServerStatus(minimal)
    expect(status).not.toBeNull()
    expect(status?.points_attention).toEqual([])
    expect(status?.evenements).toEqual([])
    expect(status?.serveur).toBe('')
    expect(status?.dernier_rapport).toBeNull()
    expect(status?.intervalle_minutes).toBe(15)
  })

  it('retire les champs inconnus', () => {
    const raw = fixture()
    const services = raw.services as Array<Record<string, unknown>>
    services[0] = { ...services[0], mot_de_passe: 'secret' }
    const status = parseServerStatus({ ...raw, chemin_interne: '/root/x' })
    expect(status).not.toBeNull()
    expect(JSON.stringify(status)).not.toContain('secret')
    expect(JSON.stringify(status)).not.toContain('/root/x')
  })

  it('écarte un événement mal formé et garde les autres', () => {
    const bon = { t: '2026-11-14T13:00:00+01:00', ts: 1_794_744_000, niveau: 'info', type: 'relance', message: 'Dovecot relancé' }
    const status = parseServerStatus({ ...fixture(), evenements: [bon, { niveau: 'grave' }, 'texte'] })
    expect(status?.evenements).toEqual([bon])
  })

  it('délivrabilité : PTR absent → null, statut inattendu → inconnu', () => {
    const raw = fixture()
    const { ptr: _ptr, ...delivrabilite } = raw.delivrabilite as Record<string, unknown>
    delivrabilite.listes = [{ nom: 'zen.spamhaus.org', statut: 'bizarre', code: null }]
    const status = parseServerStatus({ ...raw, delivrabilite })
    expect(status?.delivrabilite?.ptr).toBeNull()
    expect(status?.delivrabilite?.listes).toEqual([{ nom: 'zen.spamhaus.org', statut: 'inconnu', code: null }])
  })
})

describe('readServerStatus', () => {
  const dir = mkdtempSync(join(tmpdir(), 'colombe-etat-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lit le fichier sur disque', async () => {
    const status = await readServerStatus(fileURLToPath(fixturePath))
    expect(status?.global).toBe('attention')
  })

  it('null si le fichier manque, est illisible ou invalide', async () => {
    expect(await readServerStatus(join(dir, 'absent.json'))).toBeNull()
    expect(await readServerStatus(dir)).toBeNull()
    const invalide = join(dir, 'invalide.json')
    writeFileSync(invalide, '{ pas du json')
    expect(await readServerStatus(invalide)).toBeNull()
    const vide = join(dir, 'vide.json')
    writeFileSync(vide, '{}')
    expect(await readServerStatus(vide)).toBeNull()
  })

  it('refuse un fichier trop gros sans le lire', async () => {
    const gros = join(dir, 'gros.json')
    writeFileSync(gros, `${JSON.stringify(fixture())}${' '.repeat(MAX_STATUS_BYTES)}`)
    expect(await readServerStatus(gros)).toBeNull()
  })
})
