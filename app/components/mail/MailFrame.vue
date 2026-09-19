<script setup lang="ts">
/**
 * Rendu du corps d'un e-mail (règles de sécurité n°2 et n°3).
 * - HTML déjà assaini par le serveur (DOMPurify).
 * - iframe sandbox SANS allow-scripts ni allow-same-origin : le contenu ne peut
 *   ni exécuter de script, ni accéder à l'application.
 * - CSP propre au document : images distantes interdites tant que
 *   l'utilisateur ne les a pas autorisées.
 */
import { useI18n } from 'vue-i18n'
import { currentLocale } from '~/lib/i18n'

const props = defineProps<{
  html: string | null
  text: string | null
  showRemote: boolean
}>()

const { t } = useI18n()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<>"']+/g, url => `<a href="${url}">${url}</a>`)
}

/**
 * Wrap top-level blockquotes in collapsible details tags.
 * Uses DOMParser to safely parse and modify HTML without executing scripts.
 */
function wrapBlockquotes(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const blockquotes = Array.from(doc.querySelectorAll('body > blockquote'))
    for (const bq of blockquotes) {
      const details = doc.createElement('details')
      const summary = doc.createElement('summary')
      summary.textContent = t('mail.frame.showQuotedText')
      summary.style.cursor = 'pointer'
      summary.style.fontWeight = 'bold'
      summary.style.fontSize = '0.9em'
      summary.style.marginTop = '0.5em'
      summary.style.marginBottom = '0.5em'
      details.appendChild(summary)
      details.appendChild(bq.cloneNode(true))
      bq.replaceWith(details)
    }
    return doc.body.innerHTML
  }
  catch {
    // If parsing fails, return original HTML
    return html
  }
}

const srcdoc = computed(() => {
  const imgSrc = props.showRemote ? 'data: https:' : 'data:'
  let body = props.html !== null
    ? (props.showRemote ? unblockRemoteImages(props.html) : props.html)
    : `<pre>${linkify(escapeHtml(props.text ?? ''))}</pre>`

  // Wrap blockquotes only for HTML content (not for plain text shown in <pre>)
  if (props.html !== null) {
    body = wrapBlockquotes(body)
  }

  return `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:">`
    + `<meta name="referrer" content="no-referrer">`
    + `<base target="_blank">`
    // Papier blanc et encre bleu nuit (identité « Pli ») ; police système : la CSP du document
    // n'autorise que les polices en data:, les polices auto-hébergées de l'appli n'y entrent pas.
    + `<style>html{color-scheme:light}body{margin:0;padding:20px;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a2233;background:#fff;overflow-wrap:anywhere}`
    + `img{max-width:100%;height:auto}table{max-width:100%}pre{margin:0;white-space:pre-wrap;font:inherit}a{color:#1f3a8a;text-underline-offset:2px}blockquote{margin:0 0 0 .8ex;border-left:2px solid #cfc8b8;padding-left:1.2ex;color:#4a5061}`
    + `details{margin:0.5em 0}summary{cursor:pointer;font-weight:600;font-size:0.875em;margin:0.5em 0;color:#5a6070}</style>`
    + `</head><body>${body}</body></html>`
})
</script>

<template>
  <iframe
    :title="t('mail.frame.title')"
    sandbox="allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    :srcdoc="srcdoc"
    class="block h-full min-h-[60dvh] w-full border-0 bg-white"
  />
</template>
