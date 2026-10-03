// Server functions against the JSON API (task 084): the timer's calls through each, on the
// same build and database, so a later move of the TypeScript app to the API can be priced.
// Per read: 50 warm-ups, 100 sequential calls (p50, p95, CPU per call), and 4 seconds at 10
// concurrent calls; per write, 5 warm-up and 25 measured start-and-stop pairs. Then the largest timer read's bytes
// and its decode time in Chrome. Nothing is gated.
//
//   bun run perf:api [--no-build]
//
// The rate limit allows 120 writes a minute per user, so the server functions write as the
// admin and the API as the member. Reads are the admin's through both.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'
import { toJSONAsync } from 'seroval'
import { v7 as uuidv7 } from 'uuid'
import { type OperationName, operations } from '~/lib/api/operations'
import { requestOf } from '~/lib/api/wire'
import { table } from './checks/baseline'
import { BUILD, buildApp, signInHeaders, startApp } from './lib/app'
import { COMPANY, SEED_NOW, seededDatabase } from './lib/database'
import { cpuSeconds, percentile } from './lib/process'

const WARM_UPS = 50
const SEQUENTIAL = 100
const CONCURRENCY = 10
const CONCURRENT_MS = 4000
const WRITE_PAIRS = 25
const DECODES = 200
const DAY = 86_400_000

const { values } = parseArgs({
  options: { build: { type: 'boolean', default: true } },
  allowNegative: true,
})

// Start addresses a server function by an id from the build, next to its name in the
// server bundle.
function serverFunctionIds(build: string): Map<string, string> {
  const ids = new Map<string, string>()
  const dir = join(build, 'server/_ssr')
  for (const file of readdirSync(dir).filter((f) => f.includes('.functions-'))) {
    const text = readFileSync(join(dir, file), 'utf8')
    for (const [, id, name] of text.matchAll(/id: "([\da-f]{64})",\s*name: "(\w+)"/g)) {
      ids.set(name, id)
    }
  }
  return ids
}

type Headers = Record<string, string>
type Call = (name: OperationName, input: unknown, headers: Headers) => Promise<Response>

function viaServerFunctions(url: string, ids: Map<string, string>): Call {
  return async (name, input, headers) => {
    const { method } = operations[name]
    const payload = JSON.stringify(
      await toJSONAsync(input === undefined ? {} : { data: input }, { plugins: [] }),
    )
    const path = `/_serverFn/${ids.get(name)}`
    const common = {
      ...headers,
      'x-tsr-serverFn': 'true',
      accept: 'application/x-tss-framed, application/x-ndjson, application/json',
    }
    return method === 'GET'
      ? fetch(`${url}${path}?${new URLSearchParams({ payload })}`, { headers: common })
      : fetch(`${url}${path}`, {
          method: 'POST',
          headers: { ...common, 'content-type': 'application/json' },
          body: payload,
        })
  }
}

function viaApi(url: string): Call {
  return (name, input, headers) => {
    const operation = operations[name]
    const { path, body } = requestOf(operation, input)
    return fetch(`${url}${path}`, {
      method: operation.method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      body,
    })
  }
}

async function timed(call: () => Promise<Response>): Promise<{ ms: number; text: string }> {
  const started = performance.now()
  const response = await call()
  const text = await response.text()
  const ms = performance.now() - started
  if (!response.ok) throw new Error(`[perf] ${response.status}: ${text.slice(0, 200)}`)
  return { ms, text }
}

function ms(value: number) {
  return `${value.toFixed(1)} ms`
}

const database = await seededDatabase()
const build = values.build ? await buildApp() : BUILD
const app = await startApp({ database, build })

try {
  const ids = serverFunctionIds(build)
  const admin = { ...(await signInHeaders(app, 'admin')), origin: app.url }
  const member = { ...(await signInHeaders(app, 'member')), origin: app.url }
  const transports = [
    { name: 'server function', call: viaServerFunctions(app.url, ids), writer: admin },
    { name: 'JSON API', call: viaApi(app.url), writer: member },
  ]
  const organizationId = COMPANY.id
  const recent = {
    from: new Date(SEED_NOW.getTime() - 14 * DAY),
    to: new Date(SEED_NOW.getTime() + DAY),
  }
  const longest = {
    from: new Date(SEED_NOW.getTime() - 92 * DAY),
    to: new Date(SEED_NOW.getTime() + DAY),
  }

  // The admin's timer runs during the reads, as it would while the page is open.
  const running = uuidv7()
  const { text: startedText } = await timed(() =>
    transports[1].call('startTimer', { organizationId, id: running }, admin),
  )
  // The timer page lists the user's own entries.
  const userId = (JSON.parse(startedText) as { started: { userId: string } }).started.userId

  const reads: { name: string; operation: OperationName; input: unknown }[] = [
    { name: 'running timer', operation: 'getRunningTimer', input: undefined },
    {
      name: 'entries, 14 days',
      operation: 'listEntries',
      input: { organizationId, userId, ...recent },
    },
  ]
  const rows: string[][] = []
  const bodies = new Map<string, string>()
  for (const read of reads) {
    // Each transport runs twice, in the order A, B, B, A, so neither pays for going first.
    const runs = transports.map(() => ({
      sequential: [] as number[],
      sequentialCpu: 0,
      concurrent: [] as number[],
      concurrentCpu: 0,
      seconds: 0,
    }))
    for (const index of [0, 1, 1, 0]) {
      const transport = transports[index]
      const run = runs[index]
      function once() {
        return transport.call(read.operation, read.input, admin)
      }
      for (let i = 0; i < WARM_UPS; i++) await timed(once)

      let cpu = cpuSeconds(app.pid)
      for (let i = 0; i < SEQUENTIAL; i++) run.sequential.push((await timed(once)).ms)
      run.sequentialCpu += cpuSeconds(app.pid) - cpu

      cpu = cpuSeconds(app.pid)
      const before = run.concurrent.length
      const started = performance.now()
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (performance.now() - started < CONCURRENT_MS)
            run.concurrent.push((await timed(once)).ms)
        }),
      )
      run.seconds += (performance.now() - started) / 1000
      run.concurrentCpu += cpuSeconds(app.pid) - cpu
      if (run.concurrent.length === before) throw new Error('[perf] No concurrent calls')
    }
    for (const [index, run] of runs.entries()) {
      rows.push([
        read.name,
        transports[index].name,
        ms(percentile(run.sequential, 50)),
        ms(percentile(run.sequential, 95)),
        ms((run.sequentialCpu / run.sequential.length) * 1000),
        (run.concurrent.length / run.seconds).toFixed(0),
        ms(percentile(run.concurrent, 95)),
        ms((run.concurrentCpu / run.concurrent.length) * 1000),
      ])
    }
  }
  await timed(() => transports[1].call('stopTimer', { id: running }, admin))

  for (const transport of transports) {
    const starts: number[] = []
    const stops: number[] = []
    async function pair() {
      const id = uuidv7()
      const start = await timed(() =>
        transport.call('startTimer', { organizationId, id }, transport.writer),
      )
      const stop = await timed(() => transport.call('stopTimer', { id }, transport.writer))
      return [start.ms, stop.ms]
    }
    for (let i = 0; i < 5; i++) await pair()
    const cpu = cpuSeconds(app.pid)
    for (let i = 0; i < WRITE_PAIRS; i++) {
      const [start, stop] = await pair()
      starts.push(start)
      stops.push(stop)
    }
    const perWrite = ((cpuSeconds(app.pid) - cpu) / (2 * WRITE_PAIRS)) * 1000
    for (const [name, timings] of [
      ['start', starts],
      ['stop', stops],
    ] as const) {
      rows.push([
        name,
        transport.name,
        ms(percentile(timings, 50)),
        ms(percentile(timings, 95)),
        `${ms(perWrite)} (pair / 2)`,
        '',
        '',
        '',
      ])
    }
  }
  console.log(
    table(
      ['Call', 'Through', 'p50', 'p95', 'CPU/call', 'calls/s at 10', 'p95 at 10', 'CPU/call at 10'],
      rows,
    ),
  )

  // The largest timer reads: the 14 days the page loads, and the longest range the API allows.
  const sizes: string[][] = []
  for (const [name, range] of [
    ['entries, 14 days', recent],
    ['entries, 93 days', longest],
  ] as const) {
    for (const transport of transports) {
      const { text } = await timed(() =>
        transport.call('listEntries', { organizationId, userId, ...range }, admin),
      )
      bodies.set(`${name}|${transport.name}`, text)
      sizes.push([
        name,
        transport.name,
        `${(text.length / 1024).toFixed(1)} KB`,
        `${(gzipSync(text).length / 1024).toFixed(1)} KB`,
      ])
    }
  }

  const bundle = await Bun.build({
    entrypoints: [join(import.meta.dir, 'api-decode.ts')],
    target: 'browser',
    minify: true,
  })
  const script = await bundle.outputs[0].text()
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: script })
    for (const row of sizes) {
      const kind = row[1] === 'server function' ? 'serverFunction' : 'api'
      const text = bodies.get(`${row[0]}|${row[1]}`)!
      const timings = await page.evaluate(
        ({ kind, text, runs }) => {
          const decode = window.decoders[kind as 'serverFunction' | 'api']
          const times: number[] = []
          for (let i = 0; i < runs; i++) {
            const started = performance.now()
            decode(text)
            times.push(performance.now() - started)
          }
          return times.sort((a, b) => a - b)
        },
        { kind, text, runs: DECODES },
      )
      row.push(
        `${timings[Math.floor(timings.length / 2)].toFixed(2)} ms`,
        `${timings[Math.floor(timings.length * 0.95)].toFixed(2)} ms`,
      )
    }
    // Both decoders must give the same entries, or the comparison means nothing. Start
    // wraps a server function's answer as { result, error, context }.
    for (const name of ['entries, 14 days', 'entries, 93 days']) {
      const same = await page.evaluate(
        ({ a, b }) =>
          JSON.stringify((window.decoders.serverFunction(a) as { result: unknown }).result) ===
          JSON.stringify(window.decoders.api(b)),
        { a: bodies.get(`${name}|server function`)!, b: bodies.get(`${name}|JSON API`)! },
      )
      if (!same) throw new Error(`[perf] The decoders disagree on ${name}`)
    }
  } finally {
    await browser.close()
  }
  console.log()
  console.log(
    table(['Read', 'Through', 'Bytes', 'Gzipped', 'Decode p50, Chrome', 'Decode p95'], sizes),
  )
} finally {
  await app.stop()
}
