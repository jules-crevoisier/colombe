// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mentionsAttachment } from '../../app/utils/attachment-reminder'

describe('mentionsAttachment(html)', () => {
  describe('happy path: detects attachment mentions', () => {
    it('should return true for "pièce jointe"', () => {
      expect(mentionsAttachment('<p>Voici la pièce jointe</p>')).toBe(true)
    })

    it('should return true for "pièces jointes" (plural)', () => {
      expect(mentionsAttachment('<p>Avec les pièces jointes ci-dessous</p>')).toBe(true)
    })

    it('should return true for "piece jointe" (accents stripped)', () => {
      expect(mentionsAttachment('<p>La piece jointe est là</p>')).toBe(true)
    })

    it('should return true for "ci-joint"', () => {
      expect(mentionsAttachment('<p>Le document ci-joint vous plaira</p>')).toBe(true)
    })

    it('should return true for "PJ" (whole word, case-insensitive)', () => {
      expect(mentionsAttachment('<p>Voir le rapport pj</p>')).toBe(true)
    })

    it('should return true for "PJ" uppercase', () => {
      expect(mentionsAttachment('<p>Voir le rapport PJ</p>')).toBe(true)
    })

    it('should return true for "en attachement"', () => {
      expect(mentionsAttachment('<p>Les fichiers en attachement sont prêts</p>')).toBe(true)
    })

    it('should return true for "attached"', () => {
      expect(mentionsAttachment('<p>The file attached is here</p>')).toBe(true)
    })

    it('should be case-insensitive', () => {
      expect(mentionsAttachment('<p>Voici la PIÈCE JOINTE</p>')).toBe(true)
      expect(mentionsAttachment('<p>VOIR CI-JOINT</p>')).toBe(true)
    })
  })

  describe('false cases: no mention or partial matches', () => {
    it('should return false for plain text without attachment keywords', () => {
      expect(mentionsAttachment('<p>Bonjour, comment allez-vous?</p>')).toBe(false)
    })

    it('should return false for "PJX" (not a whole word match for PJ)', () => {
      expect(mentionsAttachment('<p>Voir le rapport PJX</p>')).toBe(false)
    })

    it('should return false for "OPJ" (not a whole word match for PJ)', () => {
      expect(mentionsAttachment('<p>Voir le rapport OPJ</p>')).toBe(false)
    })

    it('should return false for empty HTML', () => {
      expect(mentionsAttachment('')).toBe(false)
    })

    it('should return false for whitespace only', () => {
      expect(mentionsAttachment('<p>   </p>')).toBe(false)
    })
  })

  describe('blockquote handling: ignores content inside replies', () => {
    it('should ignore "pièce jointe" inside blockquote', () => {
      expect(mentionsAttachment('<p>Merci</p><blockquote><p>Voir la pièce jointe</p></blockquote>')).toBe(false)
    })

    it('should still return true when mention is before blockquote', () => {
      expect(mentionsAttachment('<p>Voici le fichier ci-joint</p><blockquote><p>Message d\'avant</p></blockquote>')).toBe(true)
    })

    it('should return true when mention is outside blockquote among other content', () => {
      expect(mentionsAttachment('<p>Le PDF pièce jointe est ci-dessous</p><blockquote><p>Ancien message</p></blockquote><p>Merci</p>')).toBe(true)
    })

    it('should ignore nested blockquotes', () => {
      expect(mentionsAttachment('<p>Test</p><blockquote><div><p>Pièce jointe</p></div></blockquote>')).toBe(false)
    })
  })

  describe('forwarded message handling: ignores content after separator', () => {
    it('should ignore mention after forwarded message separator', () => {
      expect(mentionsAttachment('<p>Pour info</p><p>---------- Message transféré ----------<br>Objet : x</p><p>Vous trouverez le relevé en pièce jointe.</p>')).toBe(false)
    })

    it('should return true when mention is before the separator', () => {
      expect(mentionsAttachment('<p>Voir le fichier ci-joint</p><p>---------- Message transféré ----------<br>Objet : x</p><p>Ancien message</p>')).toBe(true)
    })

    it('should handle variations of the separator line', () => {
      expect(mentionsAttachment('<p>Forward</p>\n---------- Message transféré ----------\n<p>pièce jointe</p>')).toBe(false)
    })

    it('should ignore all content after separator including multiple paragraphs', () => {
      expect(mentionsAttachment('<p>Important</p><p>---------- Message transféré ----------</p><p>Pièce jointe 1</p><p>Pièce jointe 2</p>')).toBe(false)
    })
  })

  describe('combined: blockquote and forwarded messages', () => {
    it('should ignore blockquote after forwarded separator', () => {
      expect(mentionsAttachment('<p>Mon message</p><p>---------- Message transféré ----------</p><blockquote><p>Pièce jointe</p></blockquote>')).toBe(false)
    })

    it('should return true for mention before both separator and blockquote', () => {
      expect(mentionsAttachment('<p>Fichier ci-joint</p><p>---------- Message transféré ----------</p><blockquote><p>Pièce jointe</p></blockquote>')).toBe(true)
    })

    it('should handle blockquote before forwarded separator', () => {
      expect(mentionsAttachment('<blockquote><p>Pièce jointe</p></blockquote><p>---------- Message transféré ----------</p><p>Autre pièce jointe</p>')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should match "pièce jointe" in various HTML contexts', () => {
      expect(mentionsAttachment('<div>Pièce jointe</div>')).toBe(true)
      expect(mentionsAttachment('<span>Pièce jointe</span>')).toBe(true)
      expect(mentionsAttachment('<li>Pièce jointe</li>')).toBe(true)
    })

    it('should handle multiple mentions', () => {
      expect(mentionsAttachment('<p>Deux pièces jointes avec PJ</p>')).toBe(true)
    })

    it('should ignore mentions inside data attributes or hidden content', () => {
      // The function should only look at visible text content
      // If pièce jointe is only in an attribute, it shouldn't match
      // But if it's in visible text anywhere, it should match
      expect(mentionsAttachment('<p data-test="pièce jointe">Normal text</p>')).toBe(false)
    })

    it('should handle malformed HTML gracefully', () => {
      expect(mentionsAttachment('<p>Pièce jointe</p><unclosed>')).toBe(true)
    })

    it('should be case-insensitive for "ci-joint"', () => {
      expect(mentionsAttachment('<p>CI-JOINT</p>')).toBe(true)
      expect(mentionsAttachment('<p>Ci-Joint</p>')).toBe(true)
    })
  })
})
