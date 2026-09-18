import { z } from 'zod'
import type { ThreadResult, MessageSummary } from '#shared/types/mail'
import { mailError, requireMail } from '#server/utils/mail-session'
import { parseMessage } from '#server/lib/mail/parse'

export default defineEventHandler(async (event): Promise<ThreadResult> => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => z.object({ uid: z.coerce.number().int().positive() }).parse(p))
    const { folder } = await getValidatedQuery(event, q => z.object({ folder: z.string().min(1).max(512) }).parse(q))

    const { backend } = await requireMail(event)

    // Get the message
    const msg = await backend.getMessage(folder, uid)
    const summary = (await backend.summaries(folder, [uid]))[0]
    if (!summary) {
      throw createError({ statusCode: 404, statusMessage: 'Message not found', message: 'Message not found' })
    }

    // Parse the message to get threading information
    const parsed = await parseMessage(msg.raw, {
      uid,
      folder,
      seen: msg.seen,
      flagged: msg.flagged,
      size: msg.size,
    })

    // Compute thread root: references[0] ?? inReplyTo ?? messageId
    let root = parsed.references?.[0] ?? parsed.inReplyTo ?? parsed.messageId
    if (!root) {
      // No threading info, return just this message
      return { items: [summary] }
    }

    // Search for related messages
    const items = new Map<string, MessageSummary>()
    items.set(`${folder}:${uid}`, summary)

    // Search in current folder for related messages
    let searchUids = await backend.searchHeader(folder, 'message-id', root)
    let summaries = await backend.summaries(folder, searchUids)
    for (const s of summaries) {
      items.set(`${folder}:${s.uid}`, s)
    }

    // Search for in-reply-to references
    searchUids = await backend.searchHeader(folder, 'in-reply-to', root)
    summaries = await backend.summaries(folder, searchUids)
    for (const s of summaries) {
      items.set(`${folder}:${s.uid}`, s)
    }

    // Search for references containing the root
    searchUids = await backend.searchHeader(folder, 'references', root)
    summaries = await backend.summaries(folder, searchUids)
    for (const s of summaries) {
      items.set(`${folder}:${s.uid}`, s)
    }

    // Also search in sent folder if different
    const folderList = await backend.listFolders()
    const sentFolder = folderList.find(f => f.specialUse === 'sent')
    if (sentFolder && sentFolder.path !== folder) {
      try {
        searchUids = await backend.searchHeader(sentFolder.path, 'message-id', root)
        summaries = await backend.summaries(sentFolder.path, searchUids)
        for (const s of summaries) {
          items.set(`${sentFolder.path}:${s.uid}`, s)
        }

        searchUids = await backend.searchHeader(sentFolder.path, 'in-reply-to', root)
        summaries = await backend.summaries(sentFolder.path, searchUids)
        for (const s of summaries) {
          items.set(`${sentFolder.path}:${s.uid}`, s)
        }

        searchUids = await backend.searchHeader(sentFolder.path, 'references', root)
        summaries = await backend.summaries(sentFolder.path, searchUids)
        for (const s of summaries) {
          items.set(`${sentFolder.path}:${s.uid}`, s)
        }
      }
      catch {
        // Ignore errors searching sent folder
      }
    }

    // Convert to array and sort by date ascending
    const threadItems = Array.from(items.values()).sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    // Cap at 50 items
    return { items: threadItems.slice(0, 50) }
  }
  catch (err) {
    throw mailError(err)
  }
})
