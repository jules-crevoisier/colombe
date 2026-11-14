/**
 * Validation du fichier d'état écrit par le script de surveillance du serveur
 * mail (voir shared/types/server-status.ts).
 *
 * - Les champs inconnus sont retirés (z.object) : seul ce que la page affiche
 *   part vers le navigateur.
 * - L'en-tête (version, date, verdict, services) est obligatoire : sans lui le
 *   fichier est refusé.
 * - Chaque bloc secondaire retombe sur null (ou une liste vide) s'il manque ou
 *   s'il est mal formé : une évolution du script ne casse pas toute la page.
 */
import { z } from 'zod'
import type { ServerStatus } from '#shared/types/server-status'

const count = z.number().int().nonnegative()
const text = z.string()
const nullableText = z.string().nullable().catch(null)

const probe = z.object({
  nom: text,
  ok: z.boolean(),
  detail: z.string().catch(''),
})

const service = z.object({
  id: text,
  nom: text,
  role: z.string().catch(''),
  actif: z.boolean(),
  sain: z.boolean(),
  depuis: nullableText,
  tests: z.array(probe).catch([]),
  relance: z.enum(['ok', 'echec', 'suspendue']).nullable().catch(null),
  relances_24h: count.catch(0),
})

const queue = z.object({
  total: count,
  hors_attente: count,
  actifs: count,
  differes: count,
  mis_de_cote: count,
  plus_ancien_minutes: count.nullable().catch(null),
  expediteurs: z.array(z.object({ adresse: text, n: count })).catch([]),
  raisons: z.array(z.object({ raison: text, n: count })).catch([]),
})

const accounts = z.object({
  total: count,
  bloques: count,
  actifs: count,
  bloques_recemment: z.array(z.object({ le: text, message: text })).catch([]),
})

const counters = {
  soumis: count,
  recu: count,
  livre_local: count,
  livre_externe: count,
  differe: count,
  rejete: count,
  rejet_entrant: count,
  quota: count,
  usurpation: count,
}

const activity = z.object({
  heures: z.array(z.object({ heure: text, debut: text, ...counters })),
  totaux_24h: z.object(counters),
})

const fail2ban = z.object({
  jails: z.array(z.object({ nom: text, bannis: count, total: count })),
  bannis: count,
})

const system = z.object({
  disques: z.array(z.object({ point: text, pourcent: z.number(), libre_go: z.number() })).catch([]),
  certificat: z.object({
    fichier: text,
    expire_le: nullableText,
    jours: z.number().int().nullable().catch(null),
  }).nullable().catch(null),
})

const deliverability = z.object({
  verifie_le: nullableText,
  domaine: text,
  ip: text,
  listes: z.array(z.object({
    nom: text,
    statut: z.enum(['propre', 'listee', 'inconnu']).catch('inconnu'),
    code: nullableText,
  })).catch([]),
  ptr: nullableText,
  spf: nullableText,
  dmarc: nullableText,
  dkim_selecteur: nullableText,
  dkim: z.boolean().catch(false),
})

const event = z.object({
  t: text,
  ts: z.number(),
  niveau: z.enum(['info', 'attention', 'critique']),
  type: text,
  message: text,
})

/** Bloc secondaire : null s'il manque ou s'il est illisible. */
function optionalBlock<T extends z.ZodType>(schema: T) {
  return schema.nullable().catch(null)
}

export const serverStatusSchema = z.object({
  version: text,
  genere_le: text,
  serveur: z.string().catch(''),
  global: z.enum(['ok', 'attention', 'panne']),
  points_attention: z.array(text).catch([]),
  services: z.array(service),
  file: optionalBlock(queue),
  comptes: optionalBlock(accounts),
  activite: optionalBlock(activity),
  fail2ban: optionalBlock(fail2ban),
  systeme: optionalBlock(system),
  delivrabilite: optionalBlock(deliverability),
  // Un événement mal formé est écarté, les autres restent.
  evenements: z.array(z.unknown()).catch([]).transform(items =>
    items.flatMap((item) => {
      const parsed = event.safeParse(item)
      return parsed.success ? [parsed.data] : []
    }),
  ),
  dernier_rapport: nullableText,
  intervalle_minutes: z.number().int().positive().catch(15),
})

/** Valide un contenu déjà décodé ; null s'il ne respecte pas le contrat. */
export function parseServerStatus(input: unknown): ServerStatus | null {
  const result = serverStatusSchema.safeParse(input)
  if (!result.success) return null
  const status: ServerStatus = result.data
  return status
}
