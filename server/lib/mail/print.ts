import { createHash } from 'node:crypto'
import type { MessageDetail } from '#shared/types/mail'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso)
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return iso
  }
}

function formatAddress(addr: { name: string; address: string } | null): string {
  if (!addr) return ''
  if (addr.name) return `${escapeHtml(addr.name)} &lt;${escapeHtml(addr.address)}&gt;`
  return escapeHtml(addr.address)
}

function formatAddresses(addrs: Array<{ name: string; address: string }>): string {
  return addrs.map(formatAddress).join('; ')
}

export function buildPrintHtml(msg: MessageDetail): Buffer {
  const printScript = 'window.print();'
  const scriptHash = createHash('sha256').update(printScript).digest('base64')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(msg.subject)}</title>
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    background: white;
    padding: 20px;
  }
  .header {
    border-bottom: 2px solid #ddd;
    padding-bottom: 20px;
    margin-bottom: 20px;
  }
  .header-row {
    display: flex;
    margin-bottom: 8px;
    min-height: 24px;
  }
  .header-label {
    font-weight: bold;
    width: 120px;
    flex-shrink: 0;
    color: #666;
  }
  .header-value {
    flex: 1;
    word-break: break-word;
  }
  .body {
    margin-top: 20px;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .body-html {
    margin-top: 20px;
  }
  @media print {
    body {
      padding: 0;
    }
    .header {
      page-break-after: avoid;
    }
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-row">
    <div class="header-label">De :</div>
    <div class="header-value">${formatAddress(msg.from)}</div>
  </div>
  ${msg.to.length > 0 ? `<div class="header-row">
    <div class="header-label">À :</div>
    <div class="header-value">${formatAddresses(msg.to)}</div>
  </div>` : ''}
  ${msg.cc.length > 0 ? `<div class="header-row">
    <div class="header-label">Cc :</div>
    <div class="header-value">${formatAddresses(msg.cc)}</div>
  </div>` : ''}
  <div class="header-row">
    <div class="header-label">Objet :</div>
    <div class="header-value">${escapeHtml(msg.subject)}</div>
  </div>
  <div class="header-row">
    <div class="header-label">Date :</div>
    <div class="header-value">${formatDate(msg.date)}</div>
  </div>
</div>
${msg.html ? `<div class="body-html">${stripRemoteImageUrls(msg.html)}</div>` : msg.text ? `<div class="body">${escapeHtml(msg.text)}</div>` : '<div class="body"><em>(pas de contenu)</em></div>'}
<script>
${printScript}
</script>
</body>
</html>`

  return Buffer.from(html, 'utf-8')
}

/** Impression : aucune URL d'image distante, même neutralisée (spec R1.3). */
function stripRemoteImageUrls(html: string): string {
  return html.replace(/\sdata-remote-src="[^"]*"/g, '')
}
