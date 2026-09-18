import { test, expect, Page, APIRequestContext, BrowserContext } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

interface AuditResult {
  screen: string
  viewport: number
  theme: 'light' | 'dark'
  violations: any[]
  overflowDetected: boolean
  smallTapTargets: Array<{ name: string; width: number; height: number }>
  smallFonts: string[]
}

const auditResults: AuditResult[] = []

async function ensureLoggedIn(page: Page, request: APIRequestContext) {
  // Check if already logged in by trying to access mail page
  const response = await page.goto('/mail/INBOX', { waitUntil: 'domcontentloaded' }).catch(() => null)

  // If we're not logged in, we'll be redirected to /login
  if (page.url().includes('/login')) {
    // Reset mock backend
    try {
      await request.post('/api/__mock/reset', {
        headers: { origin: 'http://localhost:3000' },
      })
    } catch (e) {
      // Ignore
    }

    // Now login
    const emailField = page.locator('[aria-label="Adresse e-mail"]')
    const pwdField = page.locator('[aria-label="Mot de passe"]')
    const submitBtn = page.locator('button:has-text("Se connecter")')

    await emailField.fill('dev@mmi-troyes.fr')
    await pwdField.fill('dev-password')
    await submitBtn.click()
    await page.waitForURL('/mail/**', { timeout: 10000 })
  }
}

async function auditPage(
  page: Page,
  screenName: string,
  viewportWidth: number,
  theme: 'light' | 'dark',
  testFn: (page: Page) => Promise<void>,
) {
  await page.emulateMedia({ colorScheme: theme })
  await testFn(page)
  await page.waitForLoadState('networkidle').catch(() => {})

  // Run axe scan with AxeBuilder
  let violations: any[] = []
  try {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    violations = results.violations
  } catch (e) {
    console.error(`Axe scan failed for ${screenName} @ ${viewportWidth}px:`, e)
  }

  // Check horizontal overflow
  const overflowDetected = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth
  })

  // Find small tap targets (< 44x44 at mobile/tablet)
  const smallTapTargets =
    viewportWidth < 1024
      ? await page.evaluate(() => {
          const targets: Array<{ name: string; width: number; height: number }> = []
          const selectors = ['button', 'a', 'input', '[role="checkbox"]', '[role="button"]', '[role="link"]']

          selectors.forEach((selector) => {
            try {
              document.querySelectorAll(selector).forEach((el) => {
                const rect = el.getBoundingClientRect()
                const style = getComputedStyle(el)
                // Ignore invisible/hidden elements
                if (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  rect.top < window.innerHeight
                ) {
                  if ((rect.width < 44 && rect.height >= 44) || (rect.height < 44 && rect.width >= 44) || (rect.width < 44 && rect.height < 44)) {
                    const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.className).trim().slice(0, 60).replace(/\s+/g, ' ')
                    if (name && name.length > 0 && !name.match(/^[\d\.]+$/)) {
                      targets.push({
                        name: name || 'unnamed',
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                      })
                    }
                  }
                }
              })
            } catch (e) {
              // Ignore query errors
            }
          })

          // Deduplicate
          const seen = new Set()
          return targets.filter((t) => {
            const key = `${t.name}|${t.width}|${t.height}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        })
      : []

  // Find inputs with font-size < 16px at 320px
  const smallFonts =
    viewportWidth === 320
      ? await page.evaluate(() => {
          const inputs: string[] = []
          document.querySelectorAll('input, textarea').forEach((input) => {
            const fontSize = parseInt(getComputedStyle(input).fontSize, 10)
            if (fontSize < 16 && fontSize > 0) {
              const label = input.getAttribute('aria-label') || input.placeholder || input.name || input.id || `input[type="${(input as HTMLInputElement).type}"]`
              inputs.push(`${label} (${fontSize}px)`)
            }
          })
          return [...new Set(inputs)] // Deduplicate
        })
      : []

  auditResults.push({
    screen: screenName,
    viewport: viewportWidth,
    theme,
    violations,
    overflowDetected,
    smallTapTargets,
    smallFonts,
  })
}

test.describe('Accessibility Audit', () => {
  test('audit - login page', async ({ page, request }) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 812 : 1024 })

      for (const theme of ['light', 'dark'] as const) {
        // Clear cookies for fresh login each time
        const context = page.context()
        await context.clearCookies()

        await auditPage(page, 'login', width, theme, async () => {
          await page.goto('/login')
        })
      }
    }
  })

  test('audit - inbox list', async ({ page, request }) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 812 : 1024 })

      for (const theme of ['light', 'dark'] as const) {
        // Start fresh
        const context = page.context()
        await context.clearCookies()

        await auditPage(page, 'inbox', width, theme, async () => {
          await ensureLoggedIn(page, request)
          await page.goto('/mail/INBOX')
        })
      }
    }
  })

  test('audit - opened message', async ({ page, request }) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 812 : 1024 })

      for (const theme of ['light', 'dark'] as const) {
        // Start fresh
        const context = page.context()
        await context.clearCookies()

        await auditPage(page, 'message', width, theme, async () => {
          await ensureLoggedIn(page, request)
          await page.goto('/mail/INBOX')
          await page.waitForTimeout(300)
          const msgRow = page.locator('text="Relevé de notes — semestre 4"')
          if (await msgRow.isVisible().catch(() => false)) {
            await msgRow.click()
            await page.waitForTimeout(500)
          }
        })
      }
    }
  })

  test('audit - compose window', async ({ page, request }) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 812 : 1024 })

      for (const theme of ['light', 'dark'] as const) {
        // Start fresh
        const context = page.context()
        await context.clearCookies()

        await auditPage(page, 'compose', width, theme, async () => {
          await ensureLoggedIn(page, request)
          await page.goto('/mail/INBOX')
          const composeBtn = page.locator('button:has-text("Nouveau message")')
          if (await composeBtn.isVisible().catch(() => false)) {
            await composeBtn.click()
            await page.waitForTimeout(500)
          }
        })
      }
    }
  })

  test('audit - drawer menu', async ({ page, request }) => {
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: width === 320 ? 812 : 1024 })

      for (const theme of ['light', 'dark'] as const) {
        // Start fresh
        const context = page.context()
        await context.clearCookies()

        await auditPage(page, 'drawer', width, theme, async () => {
          await ensureLoggedIn(page, request)
          await page.goto('/mail/INBOX')
          const menuBtn = page.locator('button:has-text("Menu principal")')
          if (await menuBtn.isVisible().catch(() => false)) {
            await menuBtn.click()
            await page.waitForTimeout(500)
          }
        })
      }
    }
  })

  test('keyboard - tab navigation & escape behavior', async ({ page, request }) => {
    const context = page.context()
    await context.clearCookies()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })

    await ensureLoggedIn(page, request)
    await page.goto('/mail/INBOX')

    const tabSequence: string[] = []

    // Press Tab up to 40 times
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const focusedElement = await page.locator(':focus').first()

      if (await focusedElement.isVisible().catch(() => false)) {
        try {
          const name = (await focusedElement.getAttribute('aria-label').catch(() => null)) || (await focusedElement.textContent().catch(() => null)) || (await focusedElement.getAttribute('role').catch(() => null)) || 'unknown'
          const displayName = name.toString().trim().slice(0, 60).replace(/\s+/g, ' ') || 'unnamed'
          tabSequence.push(displayName)

          // Check for visible focus indicator
          const outline = await focusedElement
            .evaluate((el) => {
              const styles = getComputedStyle(el)
              return {
                outline: styles.outline,
                outlineWidth: styles.outlineWidth,
                boxShadow: styles.boxShadow,
              }
            })
            .catch(() => ({ outline: 'none', outlineWidth: '0px', boxShadow: 'none' }))

          const hasVisibleFocus =
            (outline.outline && outline.outline !== 'none') ||
            (outline.outlineWidth && outline.outlineWidth !== '0px') ||
            (outline.boxShadow && outline.boxShadow !== 'none')

          if (!hasVisibleFocus) {
            tabSequence[tabSequence.length - 1] += ' [NO VISIBLE FOCUS]'
          }
        } catch (e) {
          tabSequence.push('error')
        }
      }
    }

    console.log('\n=== KEYBOARD NAVIGATION (Tab sequence at 1440px, light mode) ===')
    tabSequence.slice(0, 40).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item}`)
    })

    // Test Escape closes compose
    console.log('\n=== ESCAPE KEY BEHAVIOR ===')
    await page.goto('/mail/INBOX')
    const composeBtn = page.locator('button:has-text("Nouveau message")')
    if (await composeBtn.isVisible().catch(() => false)) {
      await composeBtn.click()
      await page.waitForTimeout(300)
      const beforeEscape = await page.locator('[role="dialog"]').isVisible().catch(() => false)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const afterEscape = await page.locator('[role="dialog"]').isVisible().catch(() => false)
      console.log(`  compose window: ${beforeEscape ? 'OPEN' : 'closed'} → ${afterEscape ? 'OPEN' : 'closed'} after Escape`)
    }

    // Test drawer escape at 320
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto('/mail/INBOX')
    const menuBtn = page.locator('button:has-text("Menu principal")')
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click()
      await page.waitForTimeout(300)
      const drawerOpen = await page.locator('[role="dialog"], aside, nav').first().isVisible().catch(() => false)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const drawerClosed = await page.locator('[role="dialog"], aside, nav').first().isVisible().catch(() => false)
      console.log(`  drawer: ${drawerOpen ? 'OPEN' : 'closed'} → ${drawerClosed ? 'OPEN' : 'closed'} after Escape`)
    }
  })

  test('summary - print audit results', async () => {
    // Deduplicate violations by rule id
    const violationsByRule = new Map<
      string,
      {
        impact: string
        rule: string
        count: number
        examples: Array<{ selector: string; name: string; screens: string[] }>
      }
    >()

    auditResults.forEach((result) => {
      result.violations.forEach((violation: any) => {
        const key = violation.id
        if (!violationsByRule.has(key)) {
          violationsByRule.set(key, {
            impact: violation.impact || 'unknown',
            rule: violation.id,
            count: 0,
            examples: [],
          })
        }

        const entry = violationsByRule.get(key)!
        entry.count += violation.nodes.length

        violation.nodes.slice(0, 1).forEach((node: any) => {
          const screenId = `${result.screen}-${result.viewport}-${result.theme}`
          const selector = node.html ? node.html.slice(0, 80) : 'unknown'
          const name = node.target ? node.target[0] : 'unknown'
          const existing = entry.examples.find((e) => e.selector === selector)
          if (existing) {
            existing.screens.push(screenId)
          } else {
            entry.examples.push({
              selector,
              name,
              screens: [screenId],
            })
          }
        })
      })
    })

    console.log('\n\n╔═══════════════════════════════════════════════════════════════╗')
    console.log('║           ACCESSIBILITY AUDIT SUMMARY REPORT                  ║')
    console.log('╚═══════════════════════════════════════════════════════════════╝\n')

    // Group by impact
    const byImpact = {
      critical: Array.from(violationsByRule.values()).filter((v) => v.impact === 'critical'),
      serious: Array.from(violationsByRule.values()).filter((v) => v.impact === 'serious'),
      moderate: Array.from(violationsByRule.values()).filter((v) => v.impact === 'moderate'),
      minor: Array.from(violationsByRule.values()).filter((v) => v.impact === 'minor'),
    }

    console.log('WCAG VIOLATIONS SUMMARY:')
    console.log(`  Critical:  ${byImpact.critical.length}`)
    console.log(`  Serious:   ${byImpact.serious.length}`)
    console.log(`  Moderate:  ${byImpact.moderate.length}`)
    console.log(`  Minor:     ${byImpact.minor.length}`)

    if (byImpact.critical.length > 0 || byImpact.serious.length > 0) {
      console.log('\nCRITICAL & SERIOUS VIOLATIONS:')
      ;[...byImpact.critical, ...byImpact.serious].forEach((v) => {
        console.log(`\n  ${v.impact.toUpperCase()} | ${v.rule} | count: ${v.count}`)
        v.examples.slice(0, 1).forEach((e) => {
          console.log(`    → ${e.selector.slice(0, 60)}`)
          console.log(`       Screens: ${e.screens.slice(0, 2).join(', ')}`)
        })
      })
    } else {
      console.log('\n✓ No critical or serious WCAG violations')
    }

    console.log('\n\nOVERFLOW FINDINGS:')
    const overflowFindings = auditResults.filter((r) => r.overflowDetected)
    if (overflowFindings.length === 0) {
      console.log('  ✓ No horizontal overflow at any viewport')
    } else {
      overflowFindings.forEach((r) => {
        console.log(`  ✗ ${r.screen} @ ${r.viewport}px (${r.theme}): HORIZONTAL SCROLL`)
      })
    }

    console.log('\n\nTAP TARGET FINDINGS (< 44x44 at widths < 1024):')
    const tapTargetFindings = auditResults.filter((r) => r.smallTapTargets.length > 0 && r.viewport < 1024)
    if (tapTargetFindings.length === 0) {
      console.log('  ✓ All interactive elements ≥44x44px')
    } else {
      const byViewport = new Map<number, Map<string, Array<{ name: string; width: number; height: number }>>>()
      tapTargetFindings.forEach((r) => {
        if (!byViewport.has(r.viewport)) byViewport.set(r.viewport, new Map())
        if (!byViewport.get(r.viewport)!.has(r.screen)) byViewport.get(r.viewport)!.set(r.screen, [])
        byViewport.get(r.viewport)!.get(r.screen)!.push(...r.smallTapTargets)
      })
      Array.from(byViewport.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([width, screens]) => {
          console.log(`\n  @${width}px:`)
          screens.forEach((targets, screen) => {
            console.log(`    ${screen}:`)
            targets.slice(0, 2).forEach((t) => {
              console.log(`      • "${t.name.slice(0, 40)}" (${t.width}x${t.height})`)
            })
          })
        })
    }

    console.log('\n\nFONT SIZE FINDINGS (inputs < 16px at 320px):')
    const fontFindings = auditResults.filter((r) => r.smallFonts.length > 0 && r.viewport === 320)
    if (fontFindings.length === 0) {
      console.log('  ✓ All inputs are 16px or larger')
    } else {
      fontFindings.forEach((r) => {
        console.log(`\n  ${r.screen}:`)
        r.smallFonts.forEach((f) => {
          console.log(`    • ${f}`)
        })
      })
    }

    console.log('\n\n╔═══════════════════════════════════════════════════════════════╗')
    console.log('║                      END OF AUDIT REPORT                       ║')
    console.log('╚═══════════════════════════════════════════════════════════════╝\n')
  })
})
