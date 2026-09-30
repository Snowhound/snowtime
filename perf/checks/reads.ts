// What the report functions read: rows the SQL returned and bytes of the result, for a week,
// a month, and a year, as the owner and as a plain member. Both are gated. Time per call is
// the median of a few runs and only printed.
//
// Rows are the rows the statements returned, not the rows SQLite visited: libsql doesn't
// expose sqlite3_stmt_status, and EXPLAIN QUERY PLAN shows no row counts.

import { getReport, getReportBreakdown, getReportEntries } from '~/server/reports/reports.server'
import {
  change,
  readBaseline,
  type Result,
  table,
  withinTolerance,
  writeBaseline,
} from './baseline'
import type { Recorder } from './recorder'

const RUNS = 5

interface Read {
  rows: number
  bytes: number
}
type Reads = Record<string, Read>

const RANGES = {
  week: { from: '2026-09-24', to: '2026-10-01', unit: 'day' as const },
  month: { from: '2026-09-01', to: '2026-10-01', unit: 'day' as const },
  year: { from: '2025-10-02', to: '2026-10-01', unit: 'week' as const },
}

async function measure(recorder: Recorder, call: () => Promise<unknown>) {
  await call()
  const times: number[] = []
  let read: Read = { rows: 0, bytes: 0 }
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    const { result, statements } = await recorder.record(call)
    times.push(performance.now() - started)
    read = {
      rows: statements.reduce((sum, s) => sum + s.rows, 0),
      bytes: JSON.stringify(result).length,
    }
  }
  times.sort((a, b) => a - b)
  return { read, ms: times[Math.floor(RUNS / 2)] }
}

export async function checkReads(recorder: Recorder, update: boolean): Promise<Result> {
  const { db, scopes, now } = recorder
  const current: Reads = {}
  const timings: Record<string, number> = {}

  for (const who of ['admin', 'member'] as const) {
    const scope = scopes[who]
    for (const [range, input] of Object.entries(RANGES)) {
      const calls = {
        getReport: () => getReport(db, scope, input, now),
        getReportBreakdown: () => getReportBreakdown(db, scope, input, now),
        'getReportEntries (by day)': () =>
          getReportEntries(db, scope, { report: input, view: 'day' }, now),
        'getReportEntries (by description)': () =>
          getReportEntries(db, scope, { report: input, view: 'description' }, now),
      }
      for (const [fn, call] of Object.entries(calls)) {
        const key = `${fn} ${range} ${who}`
        const { read, ms } = await measure(recorder, call)
        current[key] = read
        timings[key] = ms
      }
    }
  }

  const baseline = readBaseline('reads.json') as Reads | null
  const failures: string[] = []
  const rows: string[][] = []
  for (const [key, read] of Object.entries(current)) {
    const before = baseline?.[key]
    const bad =
      before !== undefined &&
      (read.rows > before.rows || !withinTolerance(before.bytes, read.bytes))
    if (bad) {
      failures.push(
        `${key}: ${before.rows} to ${read.rows} rows, ${before.bytes} to ${read.bytes} bytes`,
      )
    }
    rows.push([
      key,
      String(read.rows),
      change(before?.rows, read.rows),
      String(read.bytes),
      change(before?.bytes, read.bytes),
      timings[key].toFixed(1),
      bad ? 'FAIL' : '',
    ])
  }

  console.log(`\nReport reads (time is the median of ${RUNS}, not gated)`)
  console.log(table(['', 'rows', 'change', 'bytes', 'change', 'ms', ''], rows))
  if (update) writeBaseline('reads.json', current)
  else if (!baseline) failures.push('No reads.json baseline; run with --update')
  return { failures }
}
