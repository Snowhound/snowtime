// The weather bench (perf/README.md, "Weather bench"): golden frames of each kind of weather
// under SwiftShader, compared with perf/golden/, and each one's frame cost on this machine's GPU
// under the glass surfaces of a page. Timings are printed, never gated.
//
//   bun perf/weather.ts [--golden | --timing] [--update] [--all] [--layout=<name>] [--dpr=<n>]
//                       [--only=<text>] [--image=<image>-<theme>]... [--variant=<name>]...
//                       [--headed] [--swiftshader] [--window=<ms>]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { type Browser, type Page, chromium } from 'playwright-core'
import { createServer } from 'vite'
import { IMAGE_IDS, type ImageId } from '~/lib/scene/images'
import { IMAGE_WEATHER, weatherFor } from '~/lib/scene/weather'
import { gpuUsage } from './weather/gpu-usage'
import { LAYOUTS, type Layout } from './weather/layouts'
import { comparePng } from './weather/png'
import { TRACE_CATEGORIES, busyPerWindow } from './weather/trace'

const { values: flags } = parseArgs({
  options: {
    golden: { type: 'boolean' },
    timing: { type: 'boolean' },
    update: { type: 'boolean' },
    all: { type: 'boolean' },
    layout: { type: 'string', default: 'timer' },
    dpr: { type: 'string', default: '1.5' },
    only: { type: 'string' },
    image: { type: 'string', multiple: true },
    variant: { type: 'string', multiple: true },
    headed: { type: 'boolean' },
    swiftshader: { type: 'boolean' },
    window: { type: 'string' },
  },
})

// SwiftShader, Chrome's WebGL on the CPU: the same everywhere, and slow where a weak GPU is.
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const gpuFlags = flags.swiftshader ? SWIFTSHADER : []

const GOLDEN = join(import.meta.dir, 'golden')
const FAILED = join(import.meta.dir, '.cache/weather')
const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]

// Golden frames: the weather at these seconds of its time, at the sign-in page's full pace, on a
// 720 × 450 screen at pixel ratio 1, where each effect draws its fewest items.
const TIMES = [0, 7.5, 60]
const GOLDEN_SIZE = { width: 720, height: 450 }
// A pixel differs when a channel changes by more than CHANNEL of 255, and a frame fails when more
// than PIXELS differ. SwiftShader gives the same pixels on every run, so the slack is only for
// another Chrome's rounding and for rewrites meant to keep the look: a 3% change in opacity
// passes, while snowflakes 5% larger (30 to 45 pixels) or a moved leaf fail.
const CHANNEL = 8
const PIXELS = 20

// Timing: each case warms up (compiles, first frames), then is measured for WINDOW.
const WARM = 200
const WINDOW = Number(flags.window ?? 500)
const PIXEL_RATIOS = [1, 1.5, 2]

// Fields of an image's tuning that take other paths through the shaders. Images whose weather
// has the same preset and the same of these share a case, drawn with the heaviest of them (most
// items times their area); the rest only change values.
const FEATURES = ['band', 'zones', 'shear', 'gather', 'share', 'glow'] as const

type Case = {
  name: string
  label: string
  image: ImageId
  theme: Theme
  effect: string
  weight: number
}

// The case an image's weather in a theme belongs to: its preset and features, and the preset of
// its second effect.
function caseLabel(image: ImageId, theme: Theme) {
  const own = IMAGE_WEATHER[image]
  const entry = 'both' in own ? own.both : own[theme]
  const features = FEATURES.filter(
    (key) => entry[key] !== undefined || (key === 'zones' && own.zones),
  )
  return [entry.preset, ...features, ...(entry.also ? [`+${entry.also.preset}`] : [])].join(' ')
}

function cases(): Case[] {
  if (flags.image) {
    return flags.image.map((name) => {
      const theme = name.endsWith('-dark') ? 'dark' : 'light'
      const image = name.slice(0, -theme.length - 1) as ImageId
      const effect = weatherFor(image, theme).effect ?? 'none'
      return { name, label: caseLabel(image, theme), image, theme, effect, weight: 1 }
    })
  }
  const groups = new Map<string, Case>()
  for (const image of IMAGE_IDS) {
    for (const theme of THEMES) {
      const weather = weatherFor(image, theme)
      if (!weather.effect) continue
      const label = caseLabel(image, theme)
      const weight = (weather.amount ?? 1) * (weather.size ?? 1) ** 2
      const known = groups.get(label)
      if (!known || weight > known.weight) {
        groups.set(label, {
          name: `${image}-${theme}`,
          label,
          image,
          theme,
          effect: weather.effect,
          weight,
        })
      }
    }
  }
  const only = flags.only?.split(',')
  return [...groups.values()].filter(
    (c) => !only || only.some((text) => c.name.includes(text) || c.label.includes(text)),
  )
}

async function openBench(
  browser: Browser,
  base: string,
  query: Record<string, string>,
  viewport: { width: number; height: number },
  dpr: number,
): Promise<Page> {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`${base}weather.html?${new URLSearchParams(query)}`)
  try {
    await page.waitForFunction(() => window.bench, null, { timeout: 15_000 })
  } catch {
    throw new Error(`[perf] The weather bench didn't start:\n${errors.join('\n')}`)
  }
  return page
}

function show(page: Page, c: Case, t?: number) {
  return page.evaluate(([image, theme, t]) => window.bench.show({ image, theme, t }), [
    c.image,
    c.theme,
    t,
  ] as const)
}

function measure(page: Page, c: Case, key: string) {
  return page.evaluate(
    ([image, theme, warm, span, key]) => window.bench.measure({ image, theme }, warm, span, key),
    [c.image, c.theme, WARM, WINDOW, key] as const,
  )
}

async function golden(base: string, list: Case[], variant: string) {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: SWIFTSHADER,
  })
  mkdirSync(GOLDEN, { recursive: true })
  const written = new Set<string>()
  let failures = 0
  try {
    const page = await openBench(browser, base, { pace: 'full', variant }, GOLDEN_SIZE, 1)
    for (const c of list) {
      for (const t of TIMES) {
        await show(page, c, t)
        const frame = await page.screenshot()
        const file = `${c.name}-${t}.png`
        written.add(file)
        const path = join(GOLDEN, file)
        if (flags.update) {
          writeFileSync(path, frame)
          continue
        }
        if (!existsSync(path)) {
          console.log(`  ${file}: no golden frame; run with --update to add it`)
          failures++
          continue
        }
        const { size, differing, largest } = comparePng(readFileSync(path), frame, CHANNEL)
        if (size && differing <= PIXELS) continue
        mkdirSync(FAILED, { recursive: true })
        writeFileSync(join(FAILED, file), frame)
        console.log(
          `  ${file}: ${size ? `${differing} pixels differ, by up to ${largest}` : 'size differs'};` +
            ` this run's frame is in perf/.cache/weather/${file}`,
        )
        failures++
      }
    }
  } finally {
    await browser.close()
  }
  if (flags.update && !flags.only) {
    for (const file of readdirSync(GOLDEN)) {
      if (file.endsWith('.png') && !written.has(file)) rmSync(join(GOLDEN, file))
    }
  }
  const frames = list.length * TIMES.length
  console.log(
    flags.update
      ? `[perf] Wrote ${frames} golden frames to perf/golden/`
      : `[perf] Golden frames${variant ? ` (variant ${variant})` : ''}: ${frames - failures} of ${frames} match`,
  )
  return failures
}

function median(values: number[]) {
  if (!values.length) return NaN
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

type Row = {
  fps: number
  gpu: number
  mean: number
  cpu: number
  gpuPerSecond: number
  paced: number
  busy: Record<string, number>
  process: number
  usage: number
}

// Frame cost with every animation frame drawing, uncapped, then each thread's busy time with the
// app's own pacing. Variants alternate within each case, so a comparison shares the machine's
// state.
async function timing(base: string, list: Case[], layout: Layout, dpr: number, variants: string[]) {
  const rows = new Map<string, Row>()
  // t=0: the first view is a still frame, so a page runs only while it's measured.
  // With the photo, which the glass's copy needs.
  const query = { layout, dpr: String(dpr), pace: 'calm', t: '0', photo: '1' }
  const screen = { width: 1440, height: 900 }
  let renderer = ''

  const uncapped = await chromium.launch({
    channel: 'chrome',
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', ...gpuFlags],
  })
  try {
    const pages = await Promise.all(
      variants.map((variant) =>
        openBench(uncapped, base, { ...query, uncapped: '1', variant }, screen, dpr),
      ),
    )
    renderer = await pages[0].evaluate(
      () => `${window.bench.renderer}${window.bench.timerQuery ? '' : ', no GPU timer'}`,
    )
    // A page's first window runs slow, so it's thrown away.
    for (const page of pages) await measure(page, list[0], 'warm-up')
    for (const c of list) {
      for (const [i, page] of pages.entries()) {
        const key = `${c.name}/${variants[i]}`
        const sample = await measure(page, c, key)
        rows.set(key, {
          fps: sample.cpu.length / sample.seconds,
          gpu: median(sample.gpu),
          mean: sample.gpu.reduce((sum, ms) => sum + ms, 0) / sample.gpu.length,
          cpu: median(sample.cpu),
          gpuPerSecond: NaN,
          paced: 0,
          busy: {},
          process: NaN,
          usage: NaN,
        })
      }
    }
  } finally {
    await uncapped.close()
  }

  const paced = await chromium.launch({
    channel: 'chrome',
    headless: !flags.headed,
    args: gpuFlags,
  })
  try {
    const pages = await Promise.all(
      variants.map((variant) => openBench(paced, base, { ...query, variant }, screen, dpr)),
    )
    await paced.startTracing(pages[0], { categories: TRACE_CATEGORIES })
    const cdp = await paced.newBrowserCDPSession()
    // The GPU process's CPU time, all threads: the display compositor and, under SwiftShader, the
    // drawing itself.
    async function gpuProcessSeconds() {
      const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as {
        processInfo: { type: string; cpuTime: number }[]
      }
      return processInfo.filter((p) => p.type === 'GPU').reduce((sum, p) => sum + p.cpuTime, 0)
    }
    const usage = gpuUsage()
    // A page's first window runs slow, so it's thrown away.
    for (const page of pages) await measure(page, list[0], 'warm-up')
    try {
      for (const c of list) {
        for (const [i, page] of pages.entries()) {
          const key = `${c.name}/${variants[i]}`
          const cpuBefore = await gpuProcessSeconds()
          const from = performance.now()
          const sample = await measure(page, c, key)
          const to = performance.now()
          const row = rows.get(key)!
          row.paced = sample.cpu.length / sample.seconds
          row.gpuPerSecond = sample.gpu.reduce((sum, ms) => sum + ms, 0) / sample.seconds
          row.process = (((await gpuProcessSeconds()) - cpuBefore) / ((to - from) / 1000)) * 1000
          row.usage = usage.mean(from + WARM, to)
        }
      }
    } finally {
      usage.stop()
    }
    const busy = busyPerWindow(await paced.stopTracing())
    for (const [key, row] of rows) row.busy = busy.get(key) ?? {}
  } finally {
    await paced.close()
  }

  console.log(
    `\n[perf] Weather timing: ${layout} layout, pixel ratio ${dpr}, calm pace, ${renderer}\n` +
      '  Uncapped: frames per second, median and mean GPU ms per frame, and median CPU ms. Paced:\n' +
      '  the app’s frame rate, the weather’s GPU ms per second, busy ms per second on the page’s\n' +
      '  main and compositor threads, viz, and the GPU process, the GPU process’s CPU ms per\n' +
      '  second (proc), and the GPU’s utilization (macOS only).\n',
  )
  const header = [
    'case'.padEnd(30),
    'preset and features'.padEnd(26),
    'fps'.padStart(6),
    'GPU ms'.padStart(7),
    'mean'.padStart(7),
    'CPU ms'.padStart(7),
    ' │ fps'.padStart(6),
    'gpu/s'.padStart(6),
    'main'.padStart(6),
    'comp'.padStart(6),
    'viz'.padStart(6),
    'gpu'.padStart(6),
    'proc'.padStart(6),
    'use %'.padStart(6),
  ]
  console.log(`  ${header.join(' ')}`)
  for (const c of list) {
    for (const variant of variants) {
      const row = rows.get(`${c.name}/${variant}`)!
      const name = variant ? `${c.name} [${variant}]` : c.name
      const cells = [
        name.padEnd(30),
        c.label.padEnd(26),
        row.fps.toFixed(0).padStart(6),
        row.gpu.toFixed(3).padStart(7),
        row.mean.toFixed(3).padStart(7),
        row.cpu.toFixed(3).padStart(7),
        ` │ ${row.paced.toFixed(0).padStart(3)}`,
        row.gpuPerSecond.toFixed(1).padStart(6),
        ...['main', 'compositor', 'viz', 'gpu'].map((k) =>
          (row.busy[k] ?? NaN).toFixed(0).padStart(6),
        ),
        row.process.toFixed(0).padStart(6),
        row.usage.toFixed(1).padStart(6),
      ]
      console.log(`  ${cells.join(' ')}`)
    }
  }
}

const started = performance.now()
const list = cases()
const variants = flags.variant ?? ['']
if (flags.update && variants.length > 1) throw new Error('[perf] --update takes one variant')
const server = await createServer({
  configFile: join(import.meta.dir, 'weather/vite.config.ts'),
  // No file watching: a file another tool saves in perf/ mustn't reload the page mid-run.
  server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
})
await server.listen()
const base = server.resolvedUrls!.local[0]
let failures = 0
try {
  console.log(`[perf] ${list.length} weather cases, served at ${base}weather.html`)
  if (!flags.timing) {
    for (const variant of variants) failures += await golden(base, list, variant)
  }
  if (!flags.golden) {
    const layouts = flags.all ? (Object.keys(LAYOUTS) as Layout[]) : [flags.layout as Layout]
    const ratios = flags.all ? PIXEL_RATIOS : [Number(flags.dpr)]
    for (const layout of layouts) {
      for (const dpr of ratios) await timing(base, list, layout, dpr, variants)
    }
  }
} finally {
  await server.close()
}
console.log(`\n[perf] Weather bench done in ${Math.round((performance.now() - started) / 1000)} s`)
if (failures) process.exit(1)
