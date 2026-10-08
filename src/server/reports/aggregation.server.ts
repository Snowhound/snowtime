// The reports' pure part: summing entries into totals per day or week, project, team and
// member, and Breakdown's second level (aggregate, breakdownOf), and laying out the Entries
// card's pages (dayPage, mergeByDescription). reports.server.ts reads the entries and calls
// these; the tests call them directly.
import {
  addDays,
  countedSpan,
  datesBetween,
  daySplitter,
  daysBetween,
  type IsoDate,
  type Range,
  startOfDay,
  startOfWeek,
  type WeekStart,
} from '~/lib/calendar'
import {
  ENTRY_PAGE_SIZE,
  type ReportEntriesInput,
  type DescriptionRow,
  type ReportBreakdown,
  type ReportEntryPiece,
  type Totals,
  type ReportInput,
} from './reports.schemas'

export interface ReportEntry {
  userId: string
  projectId: string | null
  ticket?: string | null
  startedAt: Date
  stoppedAt: Date | null
}

export interface Aggregation {
  timeZone: string
  weekStart: WeekStart
  unit: ReportInput['unit']
  from: IsoDate
  to: IsoDate
  now: number
  // Current members of each team to total.
  teams: { teamId: string; userIds: string[] }[]
  tickets: boolean
}

function bucketsOf(a: Pick<Aggregation, 'unit' | 'weekStart' | 'from' | 'to'>): IsoDate[] {
  const step = a.unit === 'week' ? 7 : 1
  const buckets: IsoDate[] = []
  for (
    let d = a.unit === 'week' ? startOfWeek(a.from, a.weekStart) : a.from;
    d < a.to;
    d = addDays(d, step)
  ) {
    buckets.push(d)
  }
  return buckets
}

export function rangeOf(a: Pick<Aggregation, 'timeZone' | 'from' | 'to'>): Range {
  return { from: startOfDay(a.from, a.timeZone), to: startOfDay(a.to, a.timeZone) }
}

function add(t: Totals | undefined, bucket: number, ms: number) {
  if (!t) return
  t.total += ms
  t.perBucket[bucket] += ms
}

// The rows with time, most time first.
function rows<K extends string, V>(key: K, map: Map<V, Totals>) {
  return [...map]
    .filter(([, t]) => t.total > 0)
    .map(([id, t]) => ({ [key]: id, ...t }) as Totals & Record<K, V>)
    .sort((x, y) => y.total - x.total || String(x[key]).localeCompare(String(y[key])))
}

// Sums the entries into the report's buckets and rows. Pure, so the day splitting and
// running-entry rules are tested without a database.
export function aggregate(entries: ReportEntry[], a: Aggregation) {
  const buckets = bucketsOf(a)
  const range = rangeOf(a)
  const step = a.unit === 'week' ? 7 : 1
  const split = daySplitter(a.from, a.to, a.timeZone)
  const bucketOf = new Map(
    datesBetween(a.from, a.to).map((d) => [d, Math.floor(daysBetween(buckets[0], d) / step)]),
  )
  function empty() {
    return { total: 0, perBucket: buckets.map(() => 0) }
  }
  function rowOf<K>(map: Map<K, Totals>, key: K) {
    const row = map.get(key) ?? empty()
    map.set(key, row)
    return row
  }

  const all = empty()
  const projects = new Map<string | null, Totals>()
  const tickets = new Map<string | null, Totals>()
  const members = new Map<string, Totals>()
  const days = new Set<IsoDate>()
  let counted = 0
  for (const entry of entries) {
    const span = countedSpan(entry, range, a.now)
    if (!span) continue
    counted++
    const project = rowOf(projects, entry.projectId)
    const ticket = a.tickets ? rowOf(tickets, entry.ticket ?? null) : undefined
    const member = rowOf(members, entry.userId)
    for (const piece of split(span.from, span.to)) {
      const bucket = bucketOf.get(piece.date)!
      add(all, bucket, piece.ms)
      add(project, bucket, piece.ms)
      add(ticket, bucket, piece.ms)
      add(member, bucket, piece.ms)
      if (piece.ms > 0) days.add(piece.date)
    }
  }

  const teams = new Map<string, Totals>()
  for (const t of a.teams) {
    const sum = empty()
    for (const userId of t.userIds) {
      const m = members.get(userId)
      if (!m) continue
      sum.total += m.total
      m.perBucket.forEach((ms, i) => (sum.perBucket[i] += ms))
    }
    teams.set(t.teamId, sum)
  }

  return {
    ...all,
    buckets,
    trackedDays: days.size,
    entries: counted,
    projects: rows('projectId', projects),
    tickets: rows('ticket', tickets),
    members: rows('userId', members),
    teams: rows('teamId', teams),
  }
}

// Most time first, then by member.
function byMemberTotal<T extends { userId: string; total: number }>(map: Map<string, T>) {
  return [...map.values()].sort((x, y) => y.total - x.total || x.userId.localeCompare(y.userId))
}

// Sums each entry's time in the range by project and member and by ticket and member. Pure,
// like aggregate.
export function breakdownOf(
  entries: ReportEntry[],
  a: Pick<Aggregation, 'timeZone' | 'from' | 'to' | 'now' | 'tickets'>,
): ReportBreakdown {
  const range = rangeOf(a)
  const projects = new Map<string, ReportBreakdown['projects'][number]>()
  const tickets = new Map<string, ReportBreakdown['tickets'][number]>()
  for (const entry of entries) {
    const span = countedSpan(entry, range, a.now)
    if (!span) continue
    const ms = span.to - span.from
    const p = `${entry.projectId ?? ''}\u0000${entry.userId}`
    const project = projects.get(p) ?? {
      projectId: entry.projectId,
      userId: entry.userId,
      total: 0,
    }
    project.total += ms
    projects.set(p, project)
    if (!a.tickets) continue
    const t = `${entry.ticket ?? ''}\u0000${entry.userId}`
    const row = tickets.get(t) ?? { ticket: entry.ticket ?? null, userId: entry.userId, total: 0 }
    row.total += ms
    tickets.set(t, row)
  }
  return { projects: byMemberTotal(projects), tickets: byMemberTotal(tickets) }
}

export type DayCursor = NonNullable<ReportEntriesInput['after']>

// A piece's place in By day: newest day first, then each person's pieces together, newest
// first. A page's cursor is its last piece's place.
function placeOf(p: ReportEntryPiece): DayCursor {
  return { date: p.date, userId: p.userId, from: p.from.getTime(), entryId: p.entryId }
}

function byDay(a: DayCursor, b: DayCursor) {
  return (
    b.date.localeCompare(a.date) ||
    a.userId.localeCompare(b.userId) ||
    b.from - a.from ||
    a.entryId.localeCompare(b.entryId)
  )
}

// One page of By day: up to ENTRY_PAGE_SIZE pieces after the cursor. A page ends with a whole
// day when it holds more than one, so a day splits between pages only when it alone is
// longer than a page.
export function dayPage(pieces: ReportEntryPiece[], after?: DayCursor) {
  const places = new Map(pieces.map((p) => [p, placeOf(p)]))
  const sorted = pieces.toSorted((a, b) => byDay(places.get(a)!, places.get(b)!))
  let start = after ? sorted.findIndex((p) => byDay(places.get(p)!, after) > 0) : 0
  if (start < 0) start = sorted.length
  let end = Math.min(start + ENTRY_PAGE_SIZE, sorted.length)
  if (end < sorted.length) {
    let cut = end
    while (cut > start && sorted[cut - 1].date === sorted[end].date) cut--
    if (cut > start) end = cut
  }
  const page = sorted.slice(start, end)
  const totals = new Map<IsoDate, number>()
  for (const p of sorted) totals.set(p.date, (totals.get(p.date) ?? 0) + p.ms)
  const days = [...new Set(page.map((p) => p.date))].map((date) => ({
    date,
    total: totals.get(date)!,
  }))
  return { days, pieces: page, next: end < sorted.length ? places.get(sorted[end - 1])! : null }
}

// By description: one row per project, ticket, and description, most time first.
export function mergeByDescription(pieces: ReportEntryPiece[]): DescriptionRow[] {
  const rows = new Map<
    string,
    { row: DescriptionRow; entries: Set<string>; days: Set<IsoDate>; users: Set<string> }
  >()
  for (const p of pieces) {
    const key = `${p.projectId ?? ''}\u0000${p.ticket ?? ''}\u0000${p.description}`
    let r = rows.get(key)
    if (!r) {
      r = {
        row: {
          projectId: p.projectId,
          ticket: p.ticket,
          description: p.description,
          total: 0,
          entries: 0,
          days: 0,
          userIds: [],
        },
        entries: new Set(),
        days: new Set(),
        users: new Set(),
      }
      rows.set(key, r)
    }
    r.row.total += p.ms
    r.entries.add(p.entryId)
    r.days.add(p.date)
    r.users.add(p.userId)
  }
  return [...rows.values()]
    .map(({ row, entries, days, users }) => ({
      ...row,
      entries: entries.size,
      days: days.size,
      userIds: [...users],
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.description.localeCompare(b.description, 'en-US') ||
        (a.ticket ?? '').localeCompare(b.ticket ?? '', 'en-US') ||
        (a.projectId ?? '').localeCompare(b.projectId ?? '', 'en-US'),
    )
}
