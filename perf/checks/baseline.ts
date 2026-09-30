// Baseline files in perf/baselines/ and the comparison every check uses: growth past a small
// tolerance fails, a shrink or a small change is printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/database'

const DIR = join(ROOT, 'perf/baselines')

export function readBaseline(name: string): unknown {
  const path = join(DIR, name)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

export function writeBaseline(name: string, value: unknown) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(join(DIR, name), `${JSON.stringify(value, null, 2)}\n`)
}

// Growth up to 1% or 200 bytes, whichever is larger, passes.
export function withinTolerance(baseline: number, current: number, absolute = 200): boolean {
  return current - baseline <= Math.max(absolute, baseline * 0.01)
}

export function change(baseline: number | undefined, current: number): string {
  if (baseline === undefined) return 'new'
  const delta = current - baseline
  if (delta === 0) return '='
  const percent = baseline === 0 ? '' : ` (${((delta / baseline) * 100).toFixed(1)}%)`
  return `${delta > 0 ? '+' : ''}${delta}${percent}`
}

export function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  function line(cells: string[]) {
    return cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
  }
  return [line(header), ...rows.map(line)].join('\n')
}

export interface Result {
  failures: string[]
}
