import { test } from '@playwright/test'

test('simple test', async ({ page }) => {
  await page.goto('/')
  console.log('Simple test passed')
})
