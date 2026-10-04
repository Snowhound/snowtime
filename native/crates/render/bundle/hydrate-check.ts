import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Repeatable browser check of V8 HTML with Start's production client.
import { chromium } from 'playwright-core'
import { startApp, signedInContext } from '../../../../perf/lib/app'
import { seededDatabase } from '../../../../perf/lib/database'

const root = resolve(import.meta.dir, '../../../..')
const results = resolve(import.meta.dir, '../results')
const app = await startApp({ database: await seededDatabase(), build: resolve(root, '.output') })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const findings = []
try {
  for (const [name, path] of [
    ['timer', '/lumen/timer'],
    ['week', '/lumen/reports?range=this-week'],
  ]) {
    for (const source of ['start', 'v8']) {
      const context = await signedInContext(browser, app)
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      const html = readFileSync(resolve(results, `${name}-${source}.html`), 'utf8').replace(
        '</body>',
        '<script nonce="render-harness-nonce">globalThis.originalNodes=[...document.querySelectorAll("[data-hk]")];</script></body>',
      )
      await page.route(`${app.url}${path}`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: html }),
      )
      await page.goto(`${app.url}${path}`)
      await page.waitForFunction(() => !Reflect.get(globalThis, '$_TSR'))
      await page.waitForTimeout(500)
      const nodes = await page.evaluate(() => ({
        count: document.querySelectorAll('[data-hk]').length,
        replaced: globalThis.originalNodes.filter((node) => !node.isConnected).length,
      }))
      await page.screenshot({ path: resolve(results, `${name}-${source}.png`), fullPage: true })
      await page.evaluate(() => {
        globalThis.navigationMarker = 'same-document'
      })
      const target = name === 'timer' ? '/lumen/reports' : '/lumen/timer'
      await page.locator(`header a[href="${target}"]`).first().click()
      await page.waitForURL(`**${target}*`)
      const navigated = await page.evaluate(() => globalThis.navigationMarker === 'same-document')
      const result = { name, source, ...nodes, errors, navigated }
      findings.push(result)
      console.log(JSON.stringify(result))
      if (errors.length || !navigated) throw new Error(`${name} ${source} failed hydration`)
      await context.close()
    }
  }
  writeFileSync(resolve(results, 'hydration.json'), JSON.stringify(findings, null, 2))
} finally {
  await browser.close()
  await app.stop()
}
