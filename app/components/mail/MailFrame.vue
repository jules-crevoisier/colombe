<script setup lang="ts">
/**
 * Rendu du corps d'un e-mail (règles de sécurité n°2 et n°3).
 * - HTML déjà assaini par le serveur (DOMPurify).
 * - iframe sandbox SANS allow-scripts ni allow-same-origin : le contenu ne peut
 *   ni exécuter de script, ni accéder à l'application.
 * - CSP propre au document : images distantes interdites tant que
 *   l'utilisateur ne les a pas autorisées.
 */
const props = defineProps<{
  html: string | null
  text: string | null
  showRemote: boolean
}>()

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
      summary.textContent = 'Afficher le texte cité'
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

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:">`
    + `<meta name="referrer" content="no-referrer">`
    + `<base target="_blank">`
    + `<style>html{color-scheme:light}body{margin:0;padding:16px;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f1f1f;background:#fff;overflow-wrap:anywhere}`
    + `img{max-width:100%;height:auto}table{max-width:100%}pre{margin:0;white-space:pre-wrap;font:inherit}a{color:#0b57d0}blockquote{margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex}`
    + `details{margin:0.5em 0}summary{cursor:pointer;font-weight:bold;font-size:0.9em;margin:0.5em 0}</style>`
    + `</head><body>${body}</body></html>`
})
</script>

<template>
  <iframe
    title="Contenu du message"
    sandbox="allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    :srcdoc="srcdoc"
    class="block h-full min-h-[60dvh] w-full rounded-xl border-0 bg-white"
  />
</template>
