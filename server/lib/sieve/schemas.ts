/**
 * Schémas zod partagés par les routes /api/filters/* — même esprit que
 * server/lib/session/compose-schema.ts pour la rédaction.
 */
import { z } from 'zod'
import type { FilterAction, FilterCondition, FilterRule } from '#shared/types/mail'

export const NAME_RE = /^[A-Za-z0-9 _.-]{1,64}$/
export const nameSchema = z.string().refine((s) => NAME_RE.test(s), 'Nom invalide (1 à 64 caractères : lettres, chiffres, espace, _ . -)')

const address = z.string().trim().pipe(z.email())
/** Accepte un préfixe "mailto:" optionnel (URI enotify) et le retire : on stocke toujours une adresse nue. */
const notifyAddress = z.string().trim().transform((s) => s.replace(/^mailto:/i, '')).pipe(z.email())
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)')

export const conditionSchema: z.ZodType<FilterCondition> = z.object({
  field: z.enum(['from', 'to-cc', 'subject', 'size', 'header', 'body', 'date', 'spam']),
  header: z.string().max(200).optional(),
  addressPart: z.enum(['all', 'localpart', 'domain']).optional(),
  op: z.enum(['contains', 'not-contains', 'is', 'is-not', 'starts-with', 'matches', 'over', 'under', 'count-over', 'value-over', 'before', 'after']),
  value: z.string().max(998),
  caseSensitive: z.boolean().optional(),
})

export const actionSchema: z.ZodType<FilterAction> = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['move', 'copy']), folder: z.string().min(1).max(512) }),
  z.object({ type: z.enum(['mark-read', 'flag', 'delete', 'stop']) }),
  z.object({ type: z.literal('add-flag'), flag: z.string().min(1).max(200) }),
  z.object({ type: z.literal('redirect'), address, keepCopy: z.boolean() }),
  z.object({ type: z.literal('reject'), message: z.string().max(500) }),
  z.object({ type: z.literal('add-header'), name: z.string().min(1).max(200), value: z.string().max(998) }),
  z.object({ type: z.literal('notify'), address: notifyAddress, message: z.string().max(998) }),
])

export const ruleSchema: z.ZodType<FilterRule> = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  match: z.enum(['all', 'any']),
  conditions: z.array(conditionSchema).max(50),
  actions: z.array(actionSchema).min(1).max(20),
})

export const rulesSchema = z.array(ruleSchema).max(200)

export const securityConfirmationSchema = z.object({
  confirmPassword: z.string().max(512).optional(),
  totpCode: z.string().max(32).optional(),
})

export const vacationSchema = z.object({
  enabled: z.boolean(),
  from: isoDate.nullable(),
  until: isoDate.nullable(),
  subject: z.string().max(200),
  message: z.string().max(20_000),
  days: z.number().int().min(1).max(30),
  addresses: z.array(address).max(20),
  replyFrom: z.string().max(320),
  incoming: z.enum(['keep', 'discard', 'redirect', 'copy']),
  incomingAddress: address.nullable(),
}).merge(securityConfirmationSchema)

export const forwardSchema = z.object({
  enabled: z.boolean(),
  address,
  keepCopy: z.boolean(),
}).merge(securityConfirmationSchema)

export const createSetSchema = z.object({
  name: nameSchema,
  copyFrom: z.string().max(64).optional(),
})

export const setRulesBodySchema = z.object({ rules: rulesSchema }).merge(securityConfirmationSchema)
export const setScriptBodySchema = z.object({ script: z.string().min(1).max(200_000) }).merge(securityConfirmationSchema)
