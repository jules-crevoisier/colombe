import { defineStore } from 'pinia'
import { toast } from 'vue-sonner'
import type { ComposeAttachment, ComposePayload, MessageDetail } from '#shared/types/mail'

export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024
const AUTOSAVE_MS = 3000

export interface DraftAttachment extends ComposeAttachment {
  size: number
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function emptyForm() {
  return {
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
    subject: '',
    /** Corps HTML de l'éditeur riche (source de vérité). */
    html: '',
    /** Version texte tenue à jour par l'éditeur (partie text/plain). */
    text: '',
    attachments: [] as DraftAttachment[],
    inReplyTo: null as string | null,
    references: [] as string[],
    draftUid: null as number | null,
  }
}

type Form = ReturnType<typeof emptyForm>

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function cancelAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = null
}

function quoteHeader(msg: MessageDetail): string {
  const date = new Date(msg.date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
  const who = msg.from ? (msg.from.name ? `${msg.from.name} <${msg.from.address}>` : msg.from.address) : 'l’expéditeur'
  return `Le ${date}, ${who} a écrit :`
}

/** Corps cité : on repart du texte (jamais du HTML distant) pour ne rien réinjecter de l'e-mail d'origine. */
function quotedBody(msg: MessageDetail): string {
  return textToHtml((msg.text ?? msg.preview).trim())
}

export const useComposeStore = defineStore('compose', {
  state: () => ({
    isOpen: false,
    minimized: false,
    expanded: false,
    showCc: false,
    ...emptyForm(),
    dirty: false,
    saveState: 'idle' as SaveState,
    sending: false,
    /** Envoi différé en attente (annulable). */
    pendingSend: false,
  }),

  getters: {
    attachmentsBytes: state => state.attachments.reduce((sum, a) => sum + a.size, 0),
    isEmpty: state => !state.to.length && !state.cc.length && !state.bcc.length && !state.subject.trim() && !state.text.trim() && !state.attachments.length,
    title: state => state.subject.trim() || 'Nouveau message',
  },

  actions: {
    form(): Form {
      return {
        to: [...this.to],
        cc: [...this.cc],
        bcc: [...this.bcc],
        subject: this.subject,
        html: this.html,
        text: this.text,
        attachments: this.attachments.map(a => ({ ...a })),
        inReplyTo: this.inReplyTo,
        references: [...this.references],
        draftUid: this.draftUid,
      }
    },

    payload(from?: Form): ComposePayload {
      const form = from ?? this.form()
      return {
        to: form.to,
        cc: form.cc,
        bcc: form.bcc,
        subject: form.subject,
        text: form.text,
        html: form.html || null,
        inReplyTo: form.inReplyTo,
        references: form.references,
        attachments: form.attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content })),
        draftUid: form.draftUid,
      }
    },

    signature(): string {
      const { prefs } = usePrefsStore()
      return prefs.signatureEnabled ? signatureBlock(prefs.signatureHtml) : ''
    },

    async openWith(form: Partial<Form>) {
      if (this.isOpen) await this.close()
      Object.assign(this, emptyForm(), form)
      this.showCc = this.cc.length > 0 || this.bcc.length > 0
      this.isOpen = true
      this.minimized = false
      this.dirty = false
      this.saveState = 'idle'
    },

    openNew(to: string[] = []) {
      const sig = this.signature()
      return this.openWith({ to, html: sig ? `<p></p>${sig}` : '' })
    },

    openReply(msg: MessageDetail, me: string, mode: 'reply' | 'replyAll') {
      const self = me.toLowerCase()
      const direct = getReplyToAddresses(msg, me).filter(a => a.toLowerCase() !== self)
      const to = direct.length ? direct : getReplyToAddresses(msg, me)
      const lowerTo = to.map(a => a.toLowerCase())
      const cc = mode === 'replyAll'
        ? getReplyAllAddresses(msg, me).filter(a => a.toLowerCase() !== self && !lowerTo.includes(a.toLowerCase()))
        : []
      return this.openWith({
        to,
        cc,
        subject: buildReplySubject(msg.subject),
        html: `<p></p>${this.signature()}<p>${escapeHtml(quoteHeader(msg))}</p><blockquote>${quotedBody(msg)}</blockquote>`,
        inReplyTo: msg.messageId,
        references: [...msg.references, ...(msg.messageId ? [msg.messageId] : [])],
      })
    },

    openForward(msg: MessageDetail) {
      const lines = [
        '---------- Message transféré ----------',
        `De : ${msg.from ? `${msg.from.name} <${msg.from.address}>`.trim() : ''}`,
        `Date : ${new Date(msg.date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}`,
        `Objet : ${msg.subject}`,
        `À : ${msg.to.map(a => a.address).join(', ')}`,
      ]
      return this.openWith({
        subject: buildForwardSubject(msg.subject),
        html: `<p></p>${this.signature()}<p>${lines.map(escapeHtml).join('<br>')}</p>${quotedBody(msg)}`,
      })
    },

    /** Reprend un brouillon existant, pièces jointes comprises. */
    async openDraft(msg: MessageDetail) {
      const api = useMailApi()
      const attachments = await Promise.all(msg.attachments.map(async (a) => {
        const blob = await $fetch<Blob>(api.attachmentUrl(msg.folder, msg.uid, a.id), { responseType: 'blob' })
        return { filename: a.filename, contentType: a.contentType, size: blob.size, content: await blobToBase64(blob) }
      }))
      await this.openWith({
        to: msg.to.map(a => a.address),
        cc: msg.cc.map(a => a.address),
        bcc: msg.bcc.map(a => a.address),
        subject: msg.subject === '(sans objet)' ? '' : msg.subject,
        // Le HTML d'un brouillon a été produit par notre éditeur et assaini à la lecture.
        html: msg.html ?? textToHtml(msg.text ?? ''),
        text: msg.text ?? '',
        attachments,
        inReplyTo: msg.inReplyTo,
        references: msg.references,
        draftUid: msg.uid,
      })
    },

    touch() {
      this.dirty = true
      this.saveState = 'idle'
      cancelAutosave()
      autosaveTimer = setTimeout(() => {
        void this.saveDraft()
      }, AUTOSAVE_MS)
    },

    async saveDraft(): Promise<boolean> {
      cancelAutosave()
      if (!this.dirty || this.isEmpty) return true
      this.saveState = 'saving'
      try {
        const { uid } = await useMailApi().saveDraft(this.payload())
        this.draftUid = uid
        this.dirty = false
        this.saveState = 'saved'
        return true
      }
      catch {
        this.saveState = 'error'
        return false
      }
    },

    /** Ferme en enregistrant le brouillon s'il reste des modifications. */
    async close() {
      cancelAutosave()
      if (this.dirty && !this.isEmpty) {
        const saved = await this.saveDraft()
        if (saved) toast('Brouillon enregistré')
      }
      this.reset()
      await useMailStore().loadFolders()
    },

    async discard() {
      cancelAutosave()
      const drafts = useMailStore().special('drafts')
      if (this.draftUid && drafts) await useMailApi().remove(drafts.path, [this.draftUid]).catch(() => null)
      this.reset()
      toast('Brouillon supprimé')
      await useMailStore().loadFolders()
    },

    /**
     * Envoi. Si « Annuler l'envoi » est actif, la fenêtre se ferme tout de suite
     * et l'envoi part après le délai ; « Annuler » rouvre le message intact.
     * En cas d'échec, le message est rouvert : rien n'est perdu.
     */
    async send(): Promise<boolean> {
      cancelAutosave()
      const form = this.form()
      const delay = usePrefsStore().prefs.undoSendSeconds
      const doSend = async (): Promise<boolean> => {
        this.sending = true
        try {
          await useMailApi().send(this.payload(form))
          toast.success('Message envoyé')
          await useMailStore().loadFolders()
          return true
        }
        catch (err) {
          toast.error(errorText(err, 'L’envoi a échoué. Le message a été rouvert.'))
          await this.openWith(form)
          return false
        }
        finally {
          this.sending = false
          this.pendingSend = false
        }
      }

      if (!delay) {
        const ok = await doSend()
        if (ok) this.reset()
        return ok
      }

      this.reset()
      this.pendingSend = true
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          void doSend().then(resolve)
        }, delay * 1000)
        toast('Envoi en cours…', {
          duration: delay * 1000,
          action: {
            label: 'Annuler',
            onClick: () => {
              clearTimeout(timer)
              this.pendingSend = false
              void this.openWith(form).then(() => {
                this.dirty = true
                toast('Envoi annulé')
              })
              resolve(false)
            },
          },
        })
      })
    },

    async addFiles(files: FileList | File[]) {
      for (const file of Array.from(files)) {
        if (this.attachmentsBytes + file.size > MAX_ATTACHMENTS_BYTES) {
          toast.error(`« ${file.name} » dépasse la limite de 10 Mo de pièces jointes.`)
          continue
        }
        this.attachments.push({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          content: await blobToBase64(file),
        })
      }
      this.touch()
    },

    removeAttachment(index: number) {
      this.attachments.splice(index, 1)
      this.touch()
    },

    reset() {
      cancelAutosave()
      Object.assign(this, emptyForm())
      this.isOpen = false
      this.minimized = false
      this.expanded = false
      this.showCc = false
      this.dirty = false
      this.saveState = 'idle'
    },
  },
})

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
