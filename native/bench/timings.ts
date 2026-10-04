// Server-Timing of the same calls on the TypeScript build and a native server (task 088's
// names): each call repeated, one at a time, and the median of each name, so both backends'
// session and database times compare directly. Each server runs on its own copy of the
// benchmark database at SEED_NOW.
//
//   bun native/bench/timings.ts native/target/release/snowtime-axum [repeats]

import { v7 as uuidv7 } from 'uuid'
import { buildApp, signInHeaders, startApp } from '../../perf/lib/app'
import { COMPANY, SEED_NOW, seededDatabase } from '../../perf/lib/database'
import { CALLS, type CallName, requestOf } from './calls'
import { startNative } from './native'

const [binary, repeatArg] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/timings.ts <binary> [repeats]')
const repeats = Number(repeatArg ?? 50)

const DAY = 86_400_000
const organizationId = COMPANY.id
const week = { from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z') }
const quarter = { from: new Date(SEED_NOW.getTime() - 92 * DAY), to: SEED_NOW }

// Each case's input, made fresh per call for the writes.
const CASES: [string, CallName, () => unknown][] = [
  ['getRunningTimer', 'getRunningTimer', () => undefined],
  ['listEntries, week', 'listEntries', () => ({ organizationId, ...week })],
  ['listEntries, 92 days', 'listEntries', () => ({ organizationId, ...quarter })],
  ['startTimer', 'startTimer', () => ({ organizationId, id: uuidv7() })],
]

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function parse(header: string | null) {
  return Object.fromEntries(
    (header ?? '').split(',').map((part) => {
      const [name, duration] = part.trim().split(';dur=')
      return [name, Number(duration)]
    }),
  )
}

const database = await seededDatabase()
await buildApp()
const [ts, native] = await Promise.all([startApp({ database }), startNative(binary, database)])
try {
  const servers = { ts, native }
  console.log(`Medians of ${repeats} calls each, as the admin, in ms`)
  console.log(
    '| Call | TS session | TS db | TS total | native session | native db | native total |',
  )
  console.log('| --- | --: | --: | --: | --: | --: | --: |')
  for (const [label, name, input] of CASES) {
    const row: string[] = [label]
    for (const server of Object.values(servers)) {
      const headers = { ...(await signInHeaders(server, 'admin')), origin: server.url }
      const timings: Record<string, number>[] = []
      const totals: number[] = []
      for (let i = 0; i < repeats + 5; i++) {
        const operation = CALLS[name]
        const { path, body } = requestOf(operation, input())
        const started = performance.now()
        const response = await fetch(`${server.url}${path}`, {
          method: operation.method,
          headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
          body,
        })
        await response.arrayBuffer()
        if (!response.ok) throw new Error(`${label}: ${response.status}`)
        // The first calls warm the caches and the JIT.
        if (i < 5) continue
        totals.push(performance.now() - started)
        timings.push(parse(response.headers.get('server-timing')))
      }
      row.push(
        median(timings.map((t) => t.session)).toFixed(2),
        median(timings.map((t) => t.db)).toFixed(2),
        median(totals).toFixed(2),
      )
    }
    console.log(`| ${row.join(' | ')} |`)
  }
} finally {
  await Promise.all([ts.stop(), native.stop()])
}
process.exit(0)
