// Server load: how fast one app process renders signed-in pages, and the CPU and memory it
// uses doing so (task 075). Signs in as the company admin, then per page: 5 warm-ups, 30
// sequential requests (p50, p95), and 8 seconds at 10 concurrent requests (requests per
// second, p95), with the server's CPU time per request. Nothing is gated.
//
//   bun run perf:load [--no-build]          the production build under Bun
//   bun run perf:load --executable=<path>   a compiled server (bun run build:binary)
//   bun run perf:load --url=<url> --pid=<pid>
//
// With --url, the script measures a server already running on the benchmark database with
// NODE_ENV=development, for example on the self-hosted box (perf/README.md).

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { table } from './checks/baseline'
import { buildApp, signInHeaders, startApp } from './lib/app'
import { seededDatabase } from './lib/database'
import { cpuSeconds, percentile, rssMb } from './lib/process'

const PAGES = [
  { name: 'timer', path: '/lumen/timer' },
  { name: 'settings', path: '/lumen/settings' },
  { name: 'reports (week)', path: '/lumen/reports?range=this-week' },
  { name: 'reports (year)', path: '/lumen/reports?range=custom&from=2026-01-01&to=2026-09-30' },
]
const WARM_UPS = 5
const SEQUENTIAL = 30
const CONCURRENCY = 10
const CONCURRENT_MS = 8000

async function timed(url: string, headers: Record<string, string>): Promise<number> {
  const started = performance.now()
  const response = await fetch(url, { headers })
  await response.arrayBuffer()
  if (!response.ok) throw new Error(`[perf] ${url}: ${response.status}`)
  return performance.now() - started
}

const { values } = parseArgs({
  options: {
    build: { type: 'boolean', default: true },
    executable: { type: 'string' },
    url: { type: 'string' },
    pid: { type: 'string' },
  },
  allowNegative: true,
})

if (values.url && !values.pid) throw new Error('[perf] --url needs --pid, the server process.')

let app: { url: string; pid: number; stop?: () => Promise<void> }
if (values.url) {
  app = { url: values.url.replace(/\/$/, ''), pid: Number(values.pid) }
} else {
  const database = await seededDatabase()
  if (!values.executable && values.build) await buildApp()
  app = await startApp({
    database,
    executable: values.executable && resolve(values.executable),
  })
}

let peakMb = rssMb(app.pid).now
const sampler = setInterval(() => {
  peakMb = Math.max(peakMb, rssMb(app.pid).now)
}, 100)

try {
  const headers = await signInHeaders(app)
  const rows: string[][] = []
  for (const page of PAGES) {
    const url = app.url + page.path
    for (let i = 0; i < WARM_UPS; i++) await timed(url, headers)

    let cpu = cpuSeconds(app.pid)
    const sequential: number[] = []
    for (let i = 0; i < SEQUENTIAL; i++) sequential.push(await timed(url, headers))
    const sequentialCpu = (cpuSeconds(app.pid) - cpu) / SEQUENTIAL

    cpu = cpuSeconds(app.pid)
    const concurrent: number[] = []
    const started = performance.now()
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (performance.now() - started < CONCURRENT_MS)
          concurrent.push(await timed(url, headers))
      }),
    )
    const seconds = (performance.now() - started) / 1000
    const concurrentCpu = (cpuSeconds(app.pid) - cpu) / concurrent.length

    rows.push([
      page.name,
      `${percentile(sequential, 50).toFixed(1)} ms`,
      `${percentile(sequential, 95).toFixed(1)} ms`,
      `${(sequentialCpu * 1000).toFixed(1)} ms`,
      (concurrent.length / seconds).toFixed(1),
      `${percentile(concurrent, 95).toFixed(0)} ms`,
      `${(concurrentCpu * 1000).toFixed(1)} ms`,
    ])
  }
  const memory = rssMb(app.pid)
  peakMb = Math.max(peakMb, memory.now, memory.peak ?? 0)
  console.log(
    table(['Page', 'p50', 'p95', 'CPU/req', 'req/s at 10', 'p95 at 10', 'CPU/req at 10'], rows),
  )
  console.log(`\nRSS: ${memory.now.toFixed(0)} MB at the end, ${peakMb.toFixed(0)} MB peak`)
} finally {
  clearInterval(sampler)
  await app.stop?.()
}
