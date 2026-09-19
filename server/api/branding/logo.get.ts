import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { getConfig } from '../../lib/config'

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/**
 * Logo de l'établissement (COLOMBE_LOGO_FILE). Fichier fourni par l'administrateur,
 * affiché uniquement via <img> : un SVG n'y exécute aucun script. La CSP dédiée
 * l'empêche aussi s'il est ouvert directement.
 */
export default defineEventHandler(async (event) => {
  const file = getConfig().branding.logoFile
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Aucun logo', message: 'Aucun logo' })
  setResponseHeaders(event, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  })
  return await readFile(file)
})
