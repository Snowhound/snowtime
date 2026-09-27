// The Summary chart's model: one series per project, at most eight, and a y axis in whole
// steps of hours.
import { projectColor } from '~/lib/colors'
import { m } from '~/paraglide/messages.js'
import type { Row } from '../rows'

const HOUR = 3_600_000

// Past this many projects, the smallest fold into "Other", so the colors stay apart.
const MAX_SERIES = 8

// Apart from the muted "No project".
const OTHER_COLOR = 'color-mix(in oklab, var(--muted-foreground) 45%, var(--muted))'

export interface Series {
  key: string
  name: string
  // A CSS color.
  color: string
  muted?: boolean
  total: number
  perBucket: number[]
}

// The project rows as series, most time first.
export function chartSeries(rows: Row[]): Series[] {
  const series = rows.map((r) => ({
    key: r.key,
    name: r.name,
    color: projectColor(r.color),
    muted: r.muted,
    total: r.total,
    perBucket: r.perBucket,
  }))
  if (series.length <= MAX_SERIES) return series
  const rest = series.slice(MAX_SERIES - 1)
  return [
    ...series.slice(0, MAX_SERIES - 1),
    {
      key: 'other',
      name: m.reports_chart_other({ count: rest.length }),
      color: OTHER_COLOR,
      muted: true,
      total: rest.reduce((sum, s) => sum + s.total, 0),
      perBucket: rest[0].perBucket.map((_, i) => rest.reduce((sum, s) => sum + s.perBucket[i], 0)),
    },
  ]
}

const STEPS = [0.5, 1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200, 500]

// The y axis for the tallest column: at most four steps of a round number of hours, and at
// least one hour tall.
export function chartScale(maxMs: number) {
  const hours = Math.max(1, maxMs / HOUR)
  const step = STEPS.find((s) => hours / s <= 4) ?? STEPS.at(-1)!
  const max = Math.ceil(hours / step) * step
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  return { max: max * HOUR, ticks: ticks.map((h) => h * HOUR) }
}
