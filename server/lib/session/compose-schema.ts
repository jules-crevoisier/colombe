import { z } from 'zod'
import type { ComposePayload } from '#shared/types/mail'

export const MAX_RECIPIENTS = 100
export const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024

const noNewline = (s: string) => !/[\r\n]/.test(s)

function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

const attachmentSchema = z.object({
  filename: z.string().min(1).max(255).refine(f => !/[\\/\r\n\0]/.test(f), 'Nom de fichier invalide'),
  contentType: z.string().max(255).regex(/^[\w.+-]+\/[\w.+-]+$/, 'Type de fichier invalide'),
  content: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Contenu base64 invalide'),
})

const address = z.string().trim().pipe(z.email())

const messageRefSchema = z.object({
  folder: z.string().min(1).max(512),
  uid: z.number().int().positive(),
})

const baseSchema = z.object({
  to: z.array(address).max(MAX_RECIPIENTS).default([]),
  cc: z.array(address).max(MAX_RECIPIENTS).default([]),
  bcc: z.array(address).max(MAX_RECIPIENTS).default([]),
  subject: z.string().max(998).refine(noNewline, 'Objet invalide').default(''),
  text: z.string().max(5 * 1024 * 1024).default(''),
  html: z.string().max(5 * 1024 * 1024).nullish(),
  inReplyTo: z.string().max(998).refine(noNewline).nullish(),
  references: z.array(z.string().max(998).refine(noNewline)).max(100).optional(),
  attachments: z.array(attachmentSchema).max(50).optional(),
  draftUid: z.number().int().positive().nullish(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  requestReadReceipt: z.boolean().optional(),
  requestDeliveryReceipt: z.boolean().optional(),
  forwardAsAttachment: z.array(messageRefSchema).max(50).optional(),
  origin: messageRefSchema.extend({ kind: z.enum(['reply', 'forward']) }).nullish(),
})

function checkTotals(data: z.infer<typeof baseSchema>, ctx: z.RefinementCtx, requireRecipient: boolean): void {
  const count = data.to.length + data.cc.length + data.bcc.length
  if (requireRecipient && count === 0) ctx.addIssue({ code: 'custom', message: 'Au moins un destinataire est requis', path: ['to'] })
  if (count > MAX_RECIPIENTS) ctx.addIssue({ code: 'custom', message: `${MAX_RECIPIENTS} destinataires au maximum`, path: ['to'] })
  const bytes = (data.attachments ?? []).reduce((sum, a) => sum + base64Bytes(a.content), 0)
  if (bytes > MAX_ATTACHMENTS_BYTES) ctx.addIssue({ code: 'custom', message: 'Pièces jointes trop volumineuses (15 Mo max.)', path: ['attachments'] })
}

/** Envoi : au moins un destinataire. */
export const sendSchema = baseSchema.superRefine((d, ctx) => checkTotals(d, ctx, true))
/** Brouillon : destinataires facultatifs. */
export const draftSchema = baseSchema.superRefine((d, ctx) => checkTotals(d, ctx, false))

export function toPayload(d: z.infer<typeof baseSchema>): ComposePayload {
  return {
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    text: d.text,
    html: d.html ?? null,
    inReplyTo: d.inReplyTo ?? null,
    references: d.references ?? [],
    attachments: d.attachments ?? [],
    draftUid: d.draftUid ?? null,
    priority: d.priority,
    requestReadReceipt: d.requestReadReceipt,
    requestDeliveryReceipt: d.requestDeliveryReceipt,
    forwardAsAttachment: d.forwardAsAttachment,
    origin: d.origin,
  }
}
