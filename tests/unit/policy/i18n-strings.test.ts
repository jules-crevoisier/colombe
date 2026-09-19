/**
 * Politique : aucun texte français écrit en dur dans l'interface. Tout libellé visible
 * passe par vue-i18n (t(), $t, <i18n-t>) et vit dans app/locales/fr.ts + en.ts.
 *
 * Heuristique (volontairement simple) : un texte « a l'air français » s'il contient une
 * lettre accentuée ou un mot français courant. Sont examinés :
 *   - dans les templates .vue : nœuds texte, attributs statiques visibles (aria-label,
 *     placeholder, title, alt…) et chaînes littérales des expressions ({{ }}, :attr, @event) ;
 *   - dans les scripts (.vue et .ts) : chaînes littérales, hors appels console.* et imports.
 * Exclus : components/ui/** (shadcn-vue, sans texte métier), app/locales/**.
 * Exceptions : ALLOWED, par fichier et par texte exact — à garder minimal et justifié.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse } from 'vue/compiler-sfc'
import type { AttributeNode, DirectiveNode, ElementNode, InterpolationNode, RootNode, TemplateChildNode, TextNode } from '@vue/compiler-core'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ACCENTS = /[àâäçéèêëîïôöûùüÿœæÀÂÄÇÉÈÊËÎÏÔÖÛÙÜŸŒÆ«»]/
const FRENCH_WORDS = /^(le|la|les|des|du|une|et|ou|pour|avec|dans|sur|vos|votre|vous|aucun|aucune|nouveau|nouvelle|dossier|dossiers|supprimer|envoyer|annuler|enregistrer|fermer|rechercher|ajouter|modifier|afficher|masquer|brouillon|brouillons|jointe|jointes|destinataire|destinataires|objet|chargement|erreur|valider|retour|suivant|tous|toutes|lus|non)$/i

const VISIBLE_ATTRS = new Set(['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'placeholder', 'title', 'alt', 'label', 'description', 'text'])

/** Textes autorisés, par fichier (chemin relatif, séparateur « / »). */
const ALLOWED: Record<string, string[]> = {
  // Mots-clés recherchés dans le corps d'un message pour le rappel « pièce jointe oubliée » :
  // détectés quelle que soit la langue de l'interface.
  'app/utils/attachment-reminder.ts': ['*'],
  // Identifiant technique de notification (Notification.tag), jamais affiché.
  'app/composables/useLiveUpdates.ts': ['webmail-nouveau'],
  // Erreur de programmation (argument invalide), jamais montrée à l'utilisateur.
  'app/utils/lru-map.ts': ['maxSize doit être au moins 1'],
}

function isFrench(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (ACCENTS.test(value)) return true
  // Identifiants : clé de traduction (« mail.list.empty »), camelCase, nombres.
  if (/^[\w$-]+(\.[\w$-]+)+$/.test(value) || /^[a-z]+[A-Z]\w*$/.test(value) || !/\p{L}/u.test(value)) return false
  return (value.match(/\p{L}+/gu) ?? []).some(w => FRENCH_WORDS.test(w))
}

function appFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      const rel = relative('.', path).split(sep).join('/')
      return rel === 'app/components/ui' || rel === 'app/locales' ? [] : appFiles(path)
    }
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

/** Chaînes littérales d'un code TypeScript, hors console.* et chemins d'import. */
function stringLiterals(code: string): string[] {
  const source = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'console') return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text)
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

function templateTexts(root: RootNode): string[] {
  const out: string[] = []
  const expr = (code: string | undefined): void => {
    if (code) out.push(...stringLiterals(`(${code})`))
  }
  const walk = (node: RootNode | TemplateChildNode): void => {
    if (node.type === 2) out.push((node as TextNode).content)
    else if (node.type === 5) expr(((node as InterpolationNode).content as { content?: string }).content)
    if (node.type === 1) {
      for (const prop of (node as ElementNode).props) {
        if (prop.type === 6) {
          const attr = prop as AttributeNode
          if (VISIBLE_ATTRS.has(attr.name) && attr.value) out.push(attr.value.content)
        }
        else if (prop.type === 7) {
          expr(((prop as DirectiveNode).exp as { content?: string } | undefined)?.content)
        }
      }
    }
    if ('children' in node) for (const child of node.children as TemplateChildNode[]) walk(child)
  }
  walk(root)
  return out
}

function offenders(file: string): string[] {
  const rel = relative('.', file).split(sep).join('/')
  const allowed = ALLOWED[rel] ?? []
  if (allowed.includes('*')) return []
  const src = readFileSync(file, 'utf8')
  const texts: string[] = []
  if (file.endsWith('.vue')) {
    const { descriptor } = parse(src, { filename: file })
    if (descriptor.template?.ast) texts.push(...templateTexts(descriptor.template.ast))
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block) texts.push(...stringLiterals(block.content))
    }
  }
  else {
    texts.push(...stringLiterals(src))
  }
  return [...new Set(texts.map(t => t.trim()).filter(t => isFrench(t) && !allowed.includes(t)))].map(t => `${rel}: ${t}`)
}

describe('politique : textes de l\'interface traduits', () => {
  it('reconnaît un texte français et laisse passer l\'anglais et les identifiants', () => {
    expect(isFrench('Nouveau message')).toBe(true)
    expect(isFrench('Réduire')).toBe(true)
    expect(isFrench('Afficher les images')).toBe(true)
    expect(isFrench('New message')).toBe(false)
    expect(isFrench('messages')).toBe(false)
    expect(isFrench('mail.list.empty')).toBe(false)
    expect(isFrench('flex items-center')).toBe(false)
  })

  it('aucun texte français en dur dans app/ (hors app/locales et components/ui)', () => {
    const found = appFiles('app').flatMap(offenders)
    expect(found).toEqual([])
  })
})
