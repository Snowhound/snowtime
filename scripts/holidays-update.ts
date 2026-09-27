// Refreshes src/lib/holidays/ee.json from riigipühad.ee, the Estonian list of public
// holidays, so the app never calls it at runtime. It keeps the days off (kinds 1 and 2) and
// the shortened working days (kind 4), and drops the days of national importance (kind 3).
//
// Usage: bun run holidays:update

import { writeFileSync } from 'node:fs'

// riigipühad.ee, in the ASCII form a request's host takes.
const FEED = 'https://xn--riigiphad-v9a.ee/?output=json'
const OUT = 'src/lib/holidays/ee.json'
const KINDS: Record<string, 'off' | 'short'> = { '1': 'off', '2': 'off', '4': 'short' }

type Entry = { date: string; end_date: string | null; kind_id: string; title: string }

const response = await fetch(FEED)
if (!response.ok) throw new Error(`${FEED}: ${response.status} ${response.statusText}`)
const feed = (await response.json()) as Entry[]

const days = feed.flatMap((entry) => {
  const kind = KINDS[entry.kind_id]
  if (!kind) return []
  // No entry spans days today; one that did would need each of its days listed.
  if (entry.end_date && entry.end_date !== entry.date) {
    throw new Error(`${entry.title} spans ${entry.date} to ${entry.end_date}`)
  }
  return [{ date: entry.date, kind }]
})
days.sort((a, b) => a.date.localeCompare(b.date))

// One day per line, as oxfmt formats it.
const lines = days.map((d) => `  { "date": "${d.date}", "kind": "${d.kind}" }`)
writeFileSync(OUT, `[\n${lines.join(',\n')}\n]\n`)
console.log(`${OUT}: ${days.length} days, ${days[0].date} to ${days.at(-1)!.date}`)
