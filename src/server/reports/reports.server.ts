// Reports: time totals per day or week, project, team and member, in the user's time zone
// (docs/architecture.md, "Time zones"). The range's days are computed in TypeScript and
// queried as one UTC range; entries are split at the zone's midnights and summed here.
// Everyone reports on the entries they may read (readableUserIds); team totals count each
// team's current members. Results are ids, dates and milliseconds, never display text; the
// export's entry list adds each entry's own description.
import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '~/db'
import { team, teamMember, timeEntry, userSettings } from '~/db/schema'
import {
  addDays,
  countedSpan,
  daysBetween,
  type IsoDate,
  type Range,
  splitByDay,
  startOfDay,
  startOfWeek,
  type WeekStart,
} from '~/lib/calendar'
import { MAX_ENTRY_MS } from '../entries/entries.schemas'
import { AppError } from '../errors'
import { live } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
import { ENTRY_PAGE_SIZE, type ReportEntriesInput, type ReportInput } from './reports.schemas'

export interface Totals {
  total: number
  // Milliseconds per bucket, in the order of Report.buckets.
  perBucket: number[]
}

export interface Report extends Totals {
  timeZone: string
  weekStart: WeekStart
  unit: ReportInput['unit']
  // The range as UTC instants; `to` is exclusive.
  from: Date
  to: Date
  // Running entries count up to this moment.
  now: Date
  // First day of each bucket: every day of the range, or the week start of each week it
  // touches. A partial first or last week counts only the days in the range.
  buckets: IsoDate[]
  // Only rows with time, most time first. projectId null is time without a project.
  projects: (Totals & { projectId: string | null })[]
  members: (Totals & { userId: string })[]
  // A member in two teams counts in both, so team totals can add up to more than total.
  teams: (Totals & { teamId: string })[]
}

interface ReportEntry {
  userId: string
  projectId: string | null
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

function rangeOf(a: Pick<Aggregation, 'timeZone' | 'from' | 'to'>): Range {
  return { from: startOfDay(a.from, a.timeZone), to: startOfDay(a.to, a.timeZone) }
}

// Sums the entries into the report's buckets and rows. Pure, so the day splitting and
// running-entry rules are tested without a database.
export function aggregate(entries: ReportEntry[], a: Aggregation) {
  const buckets = bucketsOf(a)
  const range = rangeOf(a)
  const step = a.unit === 'week' ? 7 : 1
  function empty() {
    return { total: 0, perBucket: buckets.map(() => 0) }
  }
  function add(t: Totals, bucket: number, ms: number) {
    t.total += ms
    t.perBucket[bucket] += ms
  }

  const all = empty()
  const projects = new Map<string | null, Totals>()
  const members = new Map<string, Totals>()
  for (const entry of entries) {
    const span = countedSpan(entry, range, a.now)
    if (!span) continue
    const project = projects.get(entry.projectId) ?? empty()
    projects.set(entry.projectId, project)
    const member = members.get(entry.userId) ?? empty()
    members.set(entry.userId, member)
    for (const piece of splitByDay(span.from, span.to, a.timeZone)) {
      const bucket = Math.floor(daysBetween(buckets[0], piece.date) / step)
      add(all, bucket, piece.ms)
      add(project, bucket, piece.ms)
      add(member, bucket, piece.ms)
    }
  }

  function rows<K extends string, V>(key: K, map: Map<V, Totals>) {
    return [...map]
      .filter(([, t]) => t.total > 0)
      .map(([id, t]) => ({ [key]: id, ...t }) as Totals & Record<K, V>)
      .sort((x, y) => y.total - x.total || String(x[key]).localeCompare(String(y[key])))
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
    projects: rows('projectId', projects),
    members: rows('userId', members),
    teams: rows('teamId', teams),
  }
}

async function settingsOf(db: Database, userId: string) {
  const [row] = await db
    .select({ timeZone: userSettings.timeZone, weekStart: userSettings.weekStart })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  if (!row) throw new AppError('NOT_FOUND', 'settings_not_found')
  return row
}

// Teams the scope reports on (all for admins and owners, else those the user leads), with
// their current members, in one read.
async function reportTeams(db: Database, scope: Scope) {
  if (!isAdmin(scope) && scope.ledTeamIds.length === 0) return []
  const rows = await db
    .select({ teamId: team.id, userId: teamMember.userId })
    .from(team)
    .leftJoin(teamMember, eq(teamMember.teamId, team.id))
    .where(
      and(
        eq(team.organizationId, scope.organizationId),
        isAdmin(scope) ? undefined : inArray(team.id, scope.ledTeamIds),
      ),
    )
  const teams = new Map<string, string[]>()
  for (const { teamId, userId } of rows) {
    const userIds = teams.get(teamId) ?? []
    teams.set(teamId, userIds)
    if (userId) userIds.push(userId)
  }
  return [...teams].map(([teamId, userIds]) => ({ teamId, userIds }))
}

// The users whose entries the report counts: the readable ones, narrowed to one member or
// to one team's current members. Null means everyone in the organization.
async function reportUsers(
  db: Database,
  scope: Scope,
  input: ReportInput,
  teams: { teamId: string; userIds: string[] }[],
  readable: string[] | null,
): Promise<string[] | null> {
  if (input.userId) {
    if (readable && !readable.includes(input.userId)) {
      throw new AppError('FORBIDDEN', 'entries_forbidden')
    }
    return [input.userId]
  }
  if (input.teamId) {
    const found = teams.find((t) => t.teamId === input.teamId)
    if (found) return found.userIds
    const [exists] = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.id, input.teamId), eq(team.organizationId, scope.organizationId)))
    if (!exists) throw new AppError('NOT_FOUND', 'team_not_found')
    throw new AppError('FORBIDDEN', 'team_report_forbidden')
  }
  return readable
}

// What a report counts, from the user's settings and the scope: its days, teams, and the
// entries it may read that touch the range. The reads that don't depend on each other run
// together, since each is a round trip to the database.
async function reportData(db: Database, scope: Scope, input: ReportInput, now: Date) {
  const [settings, teams, readable] = await Promise.all([
    settingsOf(db, scope.userId),
    reportTeams(db, scope),
    readableUserIds(db, scope),
  ])
  const users = await reportUsers(db, scope, input, teams, readable)
  const a: Aggregation = {
    ...settings,
    unit: input.unit,
    from: input.from,
    to: input.to,
    now: now.getTime(),
    teams,
  }
  const range = rangeOf(a)

  const entries =
    users?.length === 0
      ? []
      : await db
          .select({
            id: timeEntry.id,
            userId: timeEntry.userId,
            projectId: timeEntry.projectId,
            description: timeEntry.description,
            ticket: timeEntry.ticket,
            startedAt: timeEntry.startedAt,
            stoppedAt: timeEntry.stoppedAt,
          })
          .from(timeEntry)
          .where(
            and(
              live(timeEntry, scope),
              users ? inArray(timeEntry.userId, users) : undefined,
              gt(timeEntry.startedAt, new Date(range.from - MAX_ENTRY_MS)),
              lt(timeEntry.startedAt, new Date(range.to)),
              or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, new Date(range.from))),
            ),
          )
  return { settings, a, range, entries }
}

type ReportData = Awaited<ReturnType<typeof reportData>>

function reportOf({ settings, a, range, entries }: ReportData, now: Date): Report {
  return {
    ...aggregate(entries, a),
    timeZone: settings.timeZone,
    weekStart: settings.weekStart,
    unit: a.unit,
    from: new Date(range.from),
    to: new Date(range.to),
    now,
  }
}

export async function getReport(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now = new Date(),
): Promise<Report> {
  return reportOf(await reportData(db, scope, input, now), now)
}

// One entry's time on one day of the range, for the export's entry list and the Entries card:
// clipped to the range, split at the zone's midnights like the report's totals, and a running
// entry up to now.
export interface ReportEntryPiece {
  entryId: string
  userId: string
  projectId: string | null
  description: string
  ticket: string | null
  date: IsoDate
  from: Date
  to: Date
  // The whole entry, which the card shows for a piece of an entry that crosses midnight.
  startedAt: Date
  stoppedAt: Date | null
  // The entry was running at `now`, so `to` is now, not its end.
  running: boolean
  ms: number
}

// The entries behind a report, oldest first.
function piecesOf({ settings, range, entries }: ReportData, now: Date): ReportEntryPiece[] {
  const pieces: ReportEntryPiece[] = []
  for (const entry of entries) {
    const span = countedSpan(entry, range, now.getTime())
    if (!span) continue
    let from = span.from
    for (const piece of splitByDay(span.from, span.to, settings.timeZone)) {
      const to = from + piece.ms
      pieces.push({
        entryId: entry.id,
        userId: entry.userId,
        projectId: entry.projectId,
        description: entry.description,
        ticket: entry.ticket,
        date: piece.date,
        from: new Date(from),
        to: new Date(to),
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt,
        running: !entry.stoppedAt && to === now.getTime(),
        ms: piece.ms,
      })
      from = to
    }
  }
  pieces.sort((x, y) => x.from.getTime() - y.from.getTime() || x.entryId.localeCompare(y.entryId))
  return pieces
}

// The report and the entries behind it, for its export, under getReport's rules. Both come
// from one read and count a running entry up to the same moment, so the entries add up to
// the report's totals.
export async function getReportExport(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now = new Date(),
): Promise<{ report: Report; timeZone: string; entries: ReportEntryPiece[] }> {
  const data = await reportData(db, scope, input, now)
  return {
    report: reportOf(data, now),
    timeZone: data.settings.timeZone,
    entries: piecesOf(data, now),
  }
}

type EntryRow = NonNullable<ReportEntriesInput['row']>
type DayCursor = NonNullable<ReportEntriesInput['after']>

// The pieces in one timesheet row. A team's row counts its current members, and "No team"
// those in none of the report's teams, as the timesheet's rows do.
function inRow(row: EntryRow, teams: Aggregation['teams']): (p: ReportEntryPiece) => boolean {
  if (row.group === 'project') {
    const projectId = row.id === 'none' ? null : row.id
    return (p) => p.projectId === projectId
  }
  if (row.group === 'member') return (p) => p.userId === row.id
  if (row.id === 'none') {
    const inTeams = new Set(teams.flatMap((t) => t.userIds))
    return (p) => !inTeams.has(p.userId)
  }
  const members = new Set(teams.find((t) => t.teamId === row.id)?.userIds)
  return (p) => members.has(p.userId)
}

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

interface EntryDay {
  date: IsoDate
  // The whole day's time in the list, also when the page holds only part of the day.
  total: number
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
  const days: EntryDay[] = [...new Set(page.map((p) => p.date))].map((date) => ({
    date,
    total: totals.get(date)!,
  }))
  return { days, pieces: page, next: end < sorted.length ? places.get(sorted[end - 1])! : null }
}

export interface DescriptionRow {
  projectId: string | null
  ticket: string | null
  description: string
  total: number
  // How many entries and days the row merges, and who tracked it.
  entries: number
  days: number
  userIds: string[]
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
        a.description.localeCompare(b.description) ||
        (a.ticket ?? '').localeCompare(b.ticket ?? '') ||
        (a.projectId ?? '').localeCompare(b.projectId ?? ''),
    )
}

// The whole list's size, whichever view and page is asked for.
interface EntriesSummary {
  // Entries, not pieces: an entry that crosses midnight counts once.
  count: number
  total: number
}

export type ReportEntries = EntriesSummary &
  (
    | { view: 'day'; days: EntryDay[]; pieces: ReportEntryPiece[]; next: DayCursor | null }
    | { view: 'description'; rows: DescriptionRow[] }
  )

// The Entries card's list, from the pieces the export reads under getReport's rules, so both
// show the same entries and count a running timer alike. The server groups and pages it, so
// a large organization's month stays a bounded response (docs/architecture.md, "Report
// entries").
export async function getReportEntries(
  db: Database,
  scope: Scope,
  input: ReportEntriesInput,
  now = new Date(),
): Promise<ReportEntries> {
  const data = await reportData(db, scope, input.report, now)
  let pieces = piecesOf(data, now)
  if (input.row) pieces = pieces.filter(inRow(input.row, data.a.teams))
  const summary = {
    count: new Set(pieces.map((p) => p.entryId)).size,
    total: pieces.reduce((sum, p) => sum + p.ms, 0),
  }
  if (input.view === 'description') {
    return { ...summary, view: 'description', rows: mergeByDescription(pieces) }
  }
  return { ...summary, view: 'day', ...dayPage(pieces, input.after) }
}
