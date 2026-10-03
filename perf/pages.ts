// Page checks in Chrome: the production build with the seeded database, signed in as the
// company admin, at 1440 x 900 and pixel ratio 1.5 with a 4x CPU slowdown. Gated: bytes and
// DOM nodes. Reported: paint, skeleton, content, long tasks, interaction delay, and load
// timings with a cold and a warm cache on a throttled network.
//
//   bun run perf:pages [--scene] [--update] [--no-build | --build=<dir>] [--audit] [--runs=<n>]

import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { change, readBaseline, table, withinTolerance, writeBaseline } from './checks/baseline'
import { htmlParts, surfaceCounts } from './checks/html'
import { buildApp, signedInContext, startApp, type RunningApp } from './lib/app'
import { seededDatabase } from './lib/database'

const BASELINE = 'pages.json'
const CPU_SLOWDOWN = 4
// Time after hydration in which lazy chunks and late tasks land, and after which the run
// reads the page.
const SETTLE_MS = 1000

// Chrome DevTools' "Fast 4G": the network of the load timings.
const NETWORK = { latency: 165, downloadThroughput: 1_125_000, uploadThroughput: 187_500 }

// `content` is what shows the page has its data: an entry row, a timesheet cell, a form
// field, a sign-in button. A page's skeleton has none of them.
interface PageSpec {
  name: string
  path: string
  content: string
  signedOut?: boolean
}

const TIMESHEET_CELL = '.timesheet tbody button'

const PAGES: PageSpec[] = [
  { name: 'reports (week)', path: '/lumen/reports?range=this-week', content: TIMESHEET_CELL },
  {
    name: 'reports (year)',
    path: '/lumen/reports?range=custom&from=2026-01-01&to=2026-09-30',
    content: TIMESHEET_CELL,
  },
  { name: 'settings', path: '/lumen/settings', content: 'main input, main select' },
  { name: 'sign-in', path: '/sign-in', content: 'main button', signedOut: true },
  // Last: its interactions add entries, which the reports would then include.
  { name: 'timer', path: '/lumen/timer', content: 'main li' },
]

// The pages the load timings open, each with a cold and then a warm cache.
const LOADS = ['timer', 'reports (week)', 'reports (year)']

// The gated numbers of one page, all counts.
interface Sizes {
  htmlBytes: number
  htmlGzip: number
  jsGzip: number
  cssGzip: number
  domNodes: number
}

// Not gated: a page rendered on the server has its data in the HTML instead.
interface Bytes {
  dataGzip: number
}

// Milliseconds from the navigation's start. Content is the first frame with the page's
// content; ready is when the page answers input, which is content for a page the browser
// renders and the end of hydration for one rendered on the server.
interface Timings {
  paintMs: number
  skeletonMs: number
  contentMs: number
  readyMs: number
  // Main-thread time, and long tasks, until content.
  mainMs: number
  longTasks: number
  longTaskMs: number
}

interface Probe {
  paint: number
  skeleton: number
  content: number
  hydrated: number
  longTasks: { start: number; duration: number }[]
  inputs: { type: string; at: number; delay: number }[]
  lastInput: number
}

declare global {
  interface Window {
    perfProbe: Probe
  }
}

// Runs in every page before its own scripts, with the page's content selector.
//
// Skeleton and content: the frame after the page's title, and after its content, is in the
// DOM, whether the parser inserts it from the server's HTML or the app renders it.
//
// Hydration, on a page rendered on the server: Solid records each element it hydrates in
// `_$HY.completed`, a WeakSet the page's first inline script creates. Wrapping its `add`
// gives the time the last element was hydrated, read once the page has settled.
//
// Input delay: from the event's timestamp (its creation by the browser, at input) to the
// second animation frame after it, so the frame that shows the handler's changes has painted.
function installProbe(content: string) {
  const probe: Probe = {
    paint: 0,
    skeleton: 0,
    content: 0,
    hydrated: 0,
    longTasks: [],
    inputs: [],
    lastInput: 0,
  }
  window.perfProbe = probe

  let skeleton = false
  const seen = new MutationObserver(() => {
    if (!skeleton && document.querySelector('h1')) {
      skeleton = true
      requestAnimationFrame(() => (probe.skeleton = performance.now()))
    }
    if (!document.querySelector(content)) return
    seen.disconnect()
    requestAnimationFrame(() => (probe.content = performance.now()))
  })
  seen.observe(document, { childList: true, subtree: true })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') probe.paint = entry.startTime
    }
  }).observe({ type: 'paint', buffered: true })

  let hy: { completed: WeakSet<object> } | undefined
  Object.defineProperty(window, '_$HY', {
    configurable: true,
    get: () => hy,
    set(value) {
      hy = value
      const add = value.completed.add.bind(value.completed)
      value.completed.add = (element: object) => {
        probe.hydrated = performance.now()
        return add(element)
      }
    },
  })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      probe.longTasks.push({ start: entry.startTime, duration: entry.duration })
    }
  }).observe({ type: 'longtask', buffered: true })

  for (const type of ['click', 'pointerover']) {
    document.addEventListener(
      type,
      (event) => {
        const input = { type, at: event.timeStamp, delay: 0 }
        probe.inputs.push(input)
        probe.lastInput = event.timeStamp
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            input.delay = performance.now() - input.at
          }),
        )
      },
      { capture: true },
    )
  }
}

// The page's own response and the scripts and styles it loads, as sent: the preview server
// doesn't compress, so bodies are gzipped here at level 9, as the budgets check does.
//
// Parts of the body that change on every request without changing its length are replaced
// by fixed text of the same length, so the gzipped size is the same on every run: the CSP
// nonce (24 random characters in script tags, meta tags, and the router's state), and the
// router's timestamps, which run on from the shifted clock.
function withoutVariation(html: string): string {
  const nonce = /<script nonce="([^"]{24})"/.exec(html)?.[1]
  return (nonce ? html.replaceAll(nonce, 'x'.repeat(24)) : html)
    .replace(/\b17\d{11}\b/g, '1700000000000')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '2000-01-01T00:00:00.000Z')
}

function collectSizes(page: Page, origin: string, audit: boolean) {
  const bodies: Promise<{ kind: 'html' | 'js' | 'css' | 'data'; body: Buffer } | null>[] = []
  const seen = new Set<string>()
  page.on('response', (response) => {
    const url = response.url()
    if (!url.startsWith(origin) || seen.has(url) || !response.ok()) return
    const type = response.request().resourceType()
    const kind = url.includes('/_serverFn/')
      ? 'data'
      : type === 'document'
        ? 'html'
        : type === 'script'
          ? 'js'
          : type === 'stylesheet'
            ? 'css'
            : null
    if (!kind) return
    seen.add(url)
    bodies.push(
      response.body().then(
        (body) => ({ kind, body }),
        () => null,
      ),
    )
  })
  return async (): Promise<Omit<Sizes, 'domNodes'> & Bytes> => {
    const sizes = { htmlBytes: 0, htmlGzip: 0, jsGzip: 0, cssGzip: 0, dataGzip: 0 }
    for (const result of await Promise.all(bodies)) {
      if (!result) continue
      if (result.kind === 'html') {
        const html = Buffer.from(withoutVariation(result.body.toString()))
        if (audit)
          console.log('[html parts]', page.url(), JSON.stringify(htmlParts(html.toString())))
        sizes.htmlBytes += html.length
        sizes.htmlGzip += gzipSync(html, { level: 9 }).length
      } else {
        sizes[`${result.kind}Gzip`] += gzipSync(result.body, { level: 9 }).length
      }
    }
    return sizes
  }
}

async function throttle(context: BrowserContext, page: Page, network: boolean) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN })
  if (network) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORK })
  }
  await cdp.send('Performance.enable')
  return cdp
}

interface Loaded {
  page: Page
  context: BrowserContext
  sizes: Sizes & Bytes
  timings: Timings
}

// Opens a page and waits for its content and, on a page rendered on the server, its
// hydration, then for it to settle, and reads its numbers. Without a context it opens one
// with an empty cache, which the caller closes; with one, the cache holds what the earlier
// pages in it loaded.
async function loadPage(
  browser: Browser,
  app: RunningApp,
  spec: PageSpec,
  { context: warm, network = false }: { context?: BrowserContext; network?: boolean } = {},
): Promise<Loaded> {
  const context = warm ?? (await signedInContext(browser, app))
  if (!warm) {
    if (spec.signedOut) await context.clearCookies()
    await context.addInitScript(installProbe, spec.content)
  }
  const page = await context.newPage()
  const cdp = await throttle(context, page, network)
  const sizesOf = collectSizes(page, app.url, process.argv.includes('--audit'))
  await page.goto(app.url + spec.path)
  await page.waitForFunction(
    () => {
      const probe = window.perfProbe
      // The probe defines _$HY; it has a value once a page rendered on the server sets it.
      // oxlint-disable-next-line no-underscore-dangle -- Solid's hydration global.
      const hydrating = (window as { _$HY?: unknown })._$HY !== undefined
      return probe.content > 0 && (!hydrating || probe.hydrated > 0)
    },
    null,
    { timeout: 60_000, polling: 'raf' },
  )
  const { metrics } = await cdp.send('Performance.getMetrics')
  const taskSeconds = metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(SETTLE_MS)
  const { domNodes, timings } = await page.evaluate(() => {
    const probe = window.perfProbe
    const early = probe.longTasks.filter((task) => task.start < probe.content)
    return {
      domNodes: document.getElementsByTagName('*').length,
      timings: {
        paintMs: probe.paint,
        skeletonMs: probe.skeleton,
        contentMs: probe.content,
        readyMs: Math.max(probe.content, probe.hydrated),
        longTasks: early.length,
        longTaskMs: early.reduce((sum, task) => sum + task.duration, 0),
      },
    }
  })
  return {
    page,
    context,
    sizes: { ...(await sizesOf()), domNodes },
    timings: { ...timings, mainMs: taskSeconds * 1000 },
  }
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// Clicks at the element's center by coordinates: Playwright's click scrolls first, and
// scrolling moves sticky headers.
async function clickAt(page: Page, selector: string, index = 0) {
  const box = await page.locator(selector).nth(index).boundingBox()
  if (!box) throw new Error(`[perf] ${selector} has no box`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

// The delay of the inputs of one type since the last reset: the slowest, since one action can
// fire several (pointerover crosses every element on its way).
async function delayOf(page: Page, type: string): Promise<number> {
  await page.waitForTimeout(300)
  return page.evaluate((wanted) => {
    const delays = window.perfProbe.inputs.filter((i) => i.type === wanted).map((i) => i.delay)
    window.perfProbe.inputs = []
    return Math.max(0, ...delays)
  }, type)
}

// Start the timer: the click to the paint after it, median of three (start, stop, start, ...).
async function startTimer(page: Page): Promise<number> {
  const delays: number[] = []
  for (let i = 0; i < 3; i++) {
    await clickAt(page, 'section[aria-label="Timer"] button:has-text("Start")')
    delays.push(await delayOf(page, 'click'))
    await clickAt(page, 'section[aria-label="Timer"] button:has-text("Stop")')
    await page.locator('section[aria-label="Timer"] button:has-text("Start")').waitFor()
  }
  return median(delays)
}

// Open an entry: hover a row, which mounts its editor, then click its project field, which
// opens a popover. Three different rows. The pointer leaves between them so each row starts
// unmounted.
async function openEntry(page: Page): Promise<{ hover: number; click: number }> {
  const hover: number[] = []
  const click: number[] = []
  for (let i = 0; i < 3; i++) {
    const box = await page.locator('main li').nth(i).boundingBox()
    if (!box) throw new Error('[perf] The entry row has no box')
    await page.mouse.move(box.x + 60, box.y + box.height / 2)
    hover.push(await delayOf(page, 'pointerover'))
    await clickAt(page, 'main li button[aria-label^="Project:"]', i)
    click.push(await delayOf(page, 'click'))
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 2)
    await page.waitForTimeout(200)
  }
  return { hover: median(hover), click: median(click) }
}

// Change the report range: the click on "Previous range" to the next paint, and to the new
// data on screen (the URL has changed and no part of the page is busy). Three steps back.
async function changeRange(page: Page): Promise<{ paint: number; data: number }> {
  const paint: number[] = []
  const data: number[] = []
  for (let i = 0; i < 3; i++) {
    const before = page.url()
    await clickAt(page, 'button[aria-label="Previous range"]')
    await page.waitForFunction(
      (url) => location.href !== url && !document.querySelector('[aria-busy="true"]'),
      before,
      { polling: 'raf' },
    )
    const settled = await page.evaluate(() => performance.now() - window.perfProbe.lastInput)
    paint.push(await delayOf(page, 'click'))
    data.push(settled)
  }
  return { paint: median(paint), data: median(data) }
}

// Go to another page with the header's link: the pointer rests on it, which starts the router's
// preload as a user's would, then clicks. The click to the new page's content on screen with
// nothing busy.
async function follow(page: Page, path: string, content: string): Promise<number> {
  const link = page.locator(`header a[href="/lumen/${path}"]:visible`).first()
  const box = await link.boundingBox()
  if (!box) throw new Error(`[perf] The ${path} link has no box`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(100)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForFunction(
    ([wanted, selector]) =>
      location.pathname.endsWith(wanted) &&
      document.querySelector(selector) !== null &&
      !document.querySelector('[aria-busy="true"]'),
    [`/${path}`, content],
    { polling: 'raf' },
  )
  const ms = await page.evaluate(() => performance.now() - window.perfProbe.lastInput)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  return ms
}

// Timer to reports and back, three times.
async function navigate(page: Page): Promise<{ toReports: number; toTimer: number }> {
  const toReports: number[] = []
  const toTimer: number[] = []
  for (let i = 0; i < 3; i++) {
    toReports.push(await follow(page, 'reports', TIMESHEET_CELL))
    toTimer.push(await follow(page, 'timer', 'main li'))
  }
  return { toReports: median(toReports), toTimer: median(toTimer) }
}

interface Interactions {
  navigateReports: number
  navigateTimer: number
  startTimer: number
  openEntryHover: number
  openEntry: number
  rangePaint: number
  rangeData: number
}

function fixed(value: number): string {
  return value.toFixed(0)
}

function timingCells(timings: Timings): string[] {
  return [
    fixed(timings.paintMs),
    fixed(timings.skeletonMs),
    fixed(timings.contentMs),
    fixed(timings.readyMs),
    fixed(timings.mainMs),
    `${timings.longTasks} / ${fixed(timings.longTaskMs)}`,
  ]
}

const TIMING_HEADER = ['paint', 'skeleton', 'content', 'ready', 'main ms', 'long n / ms']

// The median of each timing over the runs.
function medianTimings(runs: Timings[]): Timings {
  const keys = Object.keys(runs[0]) as (keyof Timings)[]
  return Object.fromEntries(keys.map((key) => [key, median(runs.map((run) => run[key]))])) as never
}

// Each page with an empty cache, then again in the same context: the browser's cache, and
// what the app keeps in storage, hold what the first load left.
async function loadTimings(browser: Browser, app: RunningApp, runs: number) {
  const rows: string[][] = []
  for (const name of LOADS) {
    const spec = PAGES.find((page) => page.name === name)!
    const cold: Timings[] = []
    const warm: Timings[] = []
    const bytes: (Sizes & Bytes)[] = []
    for (let run = 0; run < runs; run++) {
      const first = await loadPage(browser, app, spec, { network: true })
      cold.push(first.timings)
      bytes.push(first.sizes)
      await first.page.close()
      const second = await loadPage(browser, app, spec, { network: true, context: first.context })
      warm.push(second.timings)
      await first.context.close()
    }
    const sent = bytes[0]
    const sizes = `${sent.htmlGzip} / ${sent.jsGzip} / ${sent.cssGzip} / ${sent.dataGzip}`
    rows.push([`${name}, cold`, ...timingCells(medianTimings(cold)), sizes])
    rows.push([`${name}, warm`, ...timingCells(medianTimings(warm)), ''])
  }
  return rows
}

async function run() {
  const args = new Set(process.argv.slice(2))
  const started = performance.now()
  const scene = args.has('--scene')
  if (scene && args.has('--update')) {
    throw new Error('[perf] The baseline is taken with the scene off; drop --scene or --update')
  }
  // --build serves a saved copy of a build, to alternate two builds without rebuilding.
  const buildArg = process.argv.find((arg) => arg.startsWith('--build='))
  const build = buildArg && resolve(buildArg.slice('--build='.length))
  if (!build && !args.has('--no-build')) await buildApp()
  const runsArg = process.argv.find((arg) => arg.startsWith('--runs='))
  const runs = runsArg ? Number(runsArg.slice('--runs='.length)) : 3
  const app = await startApp({ database: await seededDatabase(), build, scene })
  const browser = await chromium.launch({ channel: 'chrome' })

  const sizes: Record<string, Sizes & Bytes> = {}
  const timings: Record<string, Timings> = {}
  const interactions: Partial<Interactions> = {}
  const audited: { sizes?: Sizes; timings?: Timings } = {}
  let loads: string[][] = []
  try {
    // First, while the timer has written no entries.
    loads = await loadTimings(browser, app, runs)
    for (const spec of PAGES) {
      // The gated "year" range ends at the seed's September. Audit a full twelve months
      // before Timer's interactions write entries, without changing the committed budget.
      if (args.has('--audit') && spec.name === 'timer') {
        const year = await loadPage(browser, app, {
          name: 'reports (12 months)',
          path: '/lumen/reports?range=custom&from=2025-10-01&to=2026-09-30',
          content: TIMESHEET_CELL,
        })
        console.log('[12 months]', JSON.stringify(year.sizes))
        audited.sizes = year.sizes
        audited.timings = year.timings
        console.log(
          '[surfaces]',
          'reports (12 months)',
          JSON.stringify(await year.page.evaluate(surfaceCounts)),
        )
        await year.context.close()
      }
      const loaded = await loadPage(browser, app, spec)
      if (args.has('--audit'))
        console.log(
          '[surfaces]',
          spec.name,
          JSON.stringify(await loaded.page.evaluate(surfaceCounts)),
        )
      sizes[spec.name] = loaded.sizes
      timings[spec.name] = loaded.timings
      if (spec.name === 'timer') {
        interactions.startTimer = await startTimer(loaded.page)
        const open = await openEntry(loaded.page)
        interactions.openEntryHover = open.hover
        interactions.openEntry = open.click
        const moved = await navigate(loaded.page)
        interactions.navigateReports = moved.toReports
        interactions.navigateTimer = moved.toTimer
      } else if (spec.name === 'reports (week)') {
        const range = await changeRange(loaded.page)
        interactions.rangePaint = range.paint
        interactions.rangeData = range.data
      }
      await loaded.context.close()
    }
  } finally {
    await browser.close()
    await app.stop()
  }

  const baseline = readBaseline(BASELINE) as Record<string, Sizes> | null
  const gated = ['htmlBytes', 'htmlGzip', 'jsGzip', 'cssGzip', 'domNodes'] as const
  const gatedSizes = Object.fromEntries(
    Object.entries(sizes).map(([name, page]) => [
      name,
      Object.fromEntries(gated.map((key) => [key, page[key]])),
    ]),
  )
  const failures: string[] = []
  const rows: string[][] = []
  for (const [name, now] of Object.entries(sizes)) {
    const before = baseline?.[name]
    for (const key of gated) {
      if (scene || !before) continue
      if (!withinTolerance(before[key], now[key], key === 'domNodes' ? 0 : 200)) {
        failures.push(`${name} ${key}: ${before[key]} -> ${now[key]}`)
      }
    }
    rows.push([
      name,
      ...gated.map((key) => `${now[key]} ${scene ? '' : change(before?.[key], now[key])}`.trim()),
      ...timingCells(timings[name]),
    ])
  }
  if (audited.sizes && audited.timings) {
    rows.push([
      'reports (12 months, not gated)',
      ...gated.map((key) => String(audited.sizes![key])),
      ...timingCells(audited.timings),
    ])
  }

  const scale = `${CPU_SLOWDOWN}x CPU slowdown, scene ${scene ? 'on' : 'off'}`
  console.log(`\nGated (bytes as gzipped level 9; ${scale})`)
  console.log(table(['page', 'html', 'html gz', 'js gz', 'css gz', 'dom', ...TIMING_HEADER], rows))
  console.log(
    `\nLoads, ms from navigation, median of ${runs} (${scale}, Fast 4G: 165 ms, 9 Mbit/s down)`,
  )
  console.log(table(['load', ...TIMING_HEADER, 'gz html / js / css / data'], loads))
  console.log('\nInteractions, input to next paint, median of 3 (ms)')
  console.log(
    table(
      ['interaction', 'ms'],
      [
        ['start timer (timer)', fixed(interactions.startTimer!)],
        ['hover an entry row (timer)', fixed(interactions.openEntryHover!)],
        ['open its project field (timer)', fixed(interactions.openEntry!)],
        ['previous range, to paint (reports)', fixed(interactions.rangePaint!)],
        ['previous range, to new data (reports)', fixed(interactions.rangeData!)],
        ['header link, timer to reports', fixed(interactions.navigateReports!)],
        ['header link, reports to timer', fixed(interactions.navigateTimer!)],
      ],
    ),
  )
  console.log(`\nRan in ${Math.round((performance.now() - started) / 1000)} s`)

  if (args.has('--update')) {
    writeBaseline(BASELINE, gatedSizes)
    console.log(`Wrote perf/baselines/${BASELINE}`)
  } else if (!baseline) {
    console.log(`No perf/baselines/${BASELINE} yet; run with --update`)
  } else if (scene) {
    console.log('Scene on: gated numbers are printed, not compared')
  } else if (failures.length) {
    console.log(`\nFAILED\n${failures.join('\n')}`)
    process.exit(1)
  } else {
    console.log('Gated numbers within tolerance')
  }
}

await run()
