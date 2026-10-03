// Reports: time totals per day or week, project, team and member, in the user's time zone
// (docs/architecture/data.md, "Time zones"). The range's days are computed in TypeScript and
// queried as one UTC range; entries are split at the zone's midnights and summed here.
// Everyone reports on the entries they may read (readableUserIds); team totals count each
// team's current members. Results are ids, dates and milliseconds, never display text; the
// entry lists add each entry's own description, and the report names former members.
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Database } from '~/db'
import { member, team, teamMember, timeEntry, user, userSettings } from '~/db/schema'
import {
  addDays,
  countedSpan,
  datesBetween,
  daySplitter,
  daysBetween,
  type IsoDate,
  type Range,
  localDate,
  startOfDay,
  startOfWeek,
  type WeekStart,
} from '~/lib/calendar'
import { MAX_ENTRY_MS } from '../entries/entries.schemas'
import { AppError } from '../errors'
import { live } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
import {
  DESCRIPTION_PAGE_SIZE,
  ENTRY_PAGE_SIZE,
  type EntryRow,
  type ReportEntriesInput,
  type ReportEntryTotalsInput,
  type ReportExportInput,
  type DescriptionRow,
  type ExportEntry,
  type Report,
  type ReportBreakdown,
  type ReportEntries,
  type ReportEntryPiece,
  type ReportInput,
  type Totals,
} from './reports.schemas'

interface ReportEntry {
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

function rangeOf(a: Pick<Aggregation, 'timeZone' | 'from' | 'to'>): Range {
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

// What a report counts, from the user's settings and the scope: its days, teams, and users.
// The reads that don't depend on each other run together, since each is a round trip to the
// database.
interface ReportContext {
  input: ReportInput
  a: Aggregation
  range: Range
  users: string[] | null
}

async function reportContext(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now: Date,
): Promise<ReportContext> {
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
    tickets: input.tickets ?? false,
  }
  return { input, a, range: rangeOf(a), users }
}

// A timesheet row as a condition on its entries: its project, ticket, or member, a team's
// current members, or for "No team" those in none of the report's teams, as the timesheet's
// rows count them. Null when the report may read none of the row's entries.
function rowWhere(row: EntryRow | undefined, teams: Aggregation['teams']): SQL | null | undefined {
  if (!row) return undefined
  const id = row.id === 'none' ? null : row.id
  if (row.group === 'project') return id ? eq(timeEntry.projectId, id) : isNull(timeEntry.projectId)
  if (row.group === 'ticket') return id ? eq(timeEntry.ticket, id) : isNull(timeEntry.ticket)
  if (row.group === 'member') return eq(timeEntry.userId, row.id)
  if (!id) {
    const inTeams = [...new Set(teams.flatMap((t) => t.userIds))]
    return inTeams.length > 0 ? notInArray(timeEntry.userId, inTeams) : undefined
  }
  const members = teams.find((t) => t.teamId === id)?.userIds ?? []
  return members.length > 0 ? inArray(timeEntry.userId, members) : null
}

// The report's entries that touch its range, optionally of one row. Null when there are none
// to read. `from` replaces the range's start, for a read of its later days.
function entriesWhere(scope: Scope, c: ReportContext, row?: SQL | null, from?: SQL): SQL | null {
  if (c.users?.length === 0 || row === null) return null
  const { projectId } = c.input
  return and(
    live(timeEntry, scope),
    c.users ? inArray(timeEntry.userId, c.users) : undefined,
    projectId === 'none'
      ? isNull(timeEntry.projectId)
      : projectId
        ? eq(timeEntry.projectId, projectId)
        : undefined,
    gt(
      timeEntry.startedAt,
      from ? sql`${from} - ${MAX_ENTRY_MS}` : new Date(c.range.from - MAX_ENTRY_MS),
    ),
    lt(timeEntry.startedAt, new Date(c.range.to)),
    or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, from ?? new Date(c.range.from))),
    row,
  )!
}

async function reportEntries(db: Database, scope: Scope, c: ReportContext) {
  const where = entriesWhere(scope, c)
  if (!where) return []
  return db
    .select({
      userId: timeEntry.userId,
      projectId: timeEntry.projectId,
      ticket: timeEntry.ticket,
      startedAt: timeEntry.startedAt,
      stoppedAt: timeEntry.stoppedAt,
    })
    .from(timeEntry)
    .where(where)
}

type ListedEntry = ReportEntry & { id: string; description: string; ticket: string | null }

async function listedEntries(
  db: Database,
  scope: Scope,
  c: ReportContext,
  row?: EntryRow,
): Promise<ListedEntry[]> {
  const where = entriesWhere(scope, c, rowWhere(row, c.a.teams))
  if (!where) return []
  return db
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
    .where(where)
}

// The people with entries in the organization who aren't members of it any more, with their
// names, which the member list the client names rows from leaves out. It runs beside the
// entries: the candidates come from the organization's entries, then each one is probed for
// an entry in the report's range; reportOf keeps those whose entries have time in it.
//
// The recursive CTE walks the organization's users by their index, one probe each, where
// SELECT DISTINCT would read every entry.
async function formerMembers(db: Database, scope: Scope, c: ReportContext) {
  const others = c.users?.filter((id) => id !== scope.userId)
  const inRange = entriesWhere(scope, c)
  if (!inRange || others?.length === 0) return []
  const org = scope.organizationId
  return db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      and(
        sql`${user.id} in (
          with recursive ids(id) as (
            select min(user_id) from time_entry where organization_id = ${org}
            union all
            select (select min(user_id) from time_entry where organization_id = ${org} and user_id > ids.id)
            from ids where id is not null
          )
          select id from ids
        )`,
        ne(user.id, scope.userId),
        others ? inArray(user.id, others) : undefined,
        notExists(
          db
            .select({ one: sql`1` })
            .from(member)
            .where(and(eq(member.userId, user.id), eq(member.organizationId, org))),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(timeEntry)
            .where(and(eq(timeEntry.userId, user.id), inRange)),
        ),
      ),
    )
}

function reportOf(
  c: ReportContext,
  entries: ReportEntry[],
  former: Awaited<ReturnType<typeof formerMembers>>,
  now: Date,
): Report {
  const totals = aggregate(entries, c.a)
  const counted = new Set(totals.members.map((m) => m.userId))
  return {
    ...totals,
    timeZone: c.a.timeZone,
    weekStart: c.a.weekStart,
    unit: c.a.unit,
    from: new Date(c.range.from),
    to: new Date(c.range.to),
    now,
    formerMembers: former.filter((u) => counted.has(u.userId)),
  }
}

export async function getReport(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now = new Date(),
): Promise<Report> {
  const c = await reportContext(db, scope, input, now)
  const [entries, former] = await Promise.all([
    reportEntries(db, scope, c),
    formerMembers(db, scope, c),
  ])
  return reportOf(c, entries, former, now)
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

// Breakdown's second level for the report's filters, under getReport's rules. It is apart from
// the report, which every view loads, so only Breakdown pays for it.
export async function getReportBreakdown(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now = new Date(),
): Promise<ReportBreakdown> {
  const c = await reportContext(db, scope, input, now)
  return breakdownOf(await reportEntries(db, scope, c), c.a)
}

// The pieces of the entries, oldest first.
function piecesOf(c: ReportContext, entries: ListedEntry[], now: Date): ReportEntryPiece[] {
  const pieces: ReportEntryPiece[] = []
  const split = daySplitter(c.a.from, c.a.to, c.a.timeZone)
  for (const entry of entries) {
    const span = countedSpan(entry, c.range, now.getTime())
    if (!span) continue
    let from = span.from
    for (const piece of split(span.from, span.to)) {
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

// One piece of the report's export, under getReport's rules: the entries of the piece's days,
// and for the first piece the report. Every piece counts a running entry up to the first
// one's moment, so the pieces' entries add up to the report's totals.
export async function getReportExport(
  db: Database,
  scope: Scope,
  input: ReportExportInput,
  now = new Date(),
): Promise<{ report?: Report; entries: ExportEntry[] }> {
  // Never later than the server's now, so a piece can't count a running entry further ahead.
  const at = new Date(Math.min(input.now?.getTime() ?? Infinity, now.getTime()))
  const c = await reportContext(db, scope, { ...input.report, from: input.from, to: input.to }, at)
  const [report, entries] = await Promise.all([
    input.now ? undefined : getReport(db, scope, input.report, at),
    listedEntries(db, scope, c),
  ])
  return {
    report,
    entries: piecesOf(c, entries, at).map((p) => ({
      userId: p.userId,
      projectId: p.projectId,
      description: p.description,
      ticket: p.ticket,
      date: p.date,
      from: p.from,
      running: p.running,
      ms: p.ms,
    })),
  }
}

type DayCursor = NonNullable<ReportEntriesInput['after']>

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

// Probe the newest starts with LIMIT, then read their whole days. The day/member ordering
// and whole-day totals need all entries on a boundary day, including overnight entries.
// One statement does both: CTEs find the window's first day, and the entries read joins it
// as its outer loop (CROSS JOIN keeps that order), so the window's start bounds the index
// range. With the start in a subquery instead, SQLite bounds the index by the range and
// reads, and Turso bills, every entry in it.
async function pagedDays(
  db: Database,
  scope: Scope,
  c: ReportContext,
  input: ReportEntriesInput,
  now: Date,
) {
  const row = rowWhere(input.row, c.a.teams)
  const where = entriesWhere(scope, c, row)
  if (!where) return dayPage([], input.after)
  const counted = sql`min(
    coalesce(${timeEntry.stoppedAt}, min(${now.getTime()}, ${timeEntry.startedAt} + ${MAX_ENTRY_MS})),
    ${c.range.to}
  ) > max(${timeEntry.startedAt}, ${c.range.from})`
  const dayStarts = JSON.stringify(
    datesBetween(c.a.from, c.a.to).map((d) => startOfDay(d, c.a.timeZone)),
  )
  for (let limit = ENTRY_PAGE_SIZE + 1; ; limit *= 2) {
    const probe = db
      .$with('probe')
      .as(
        db
          .select({ startedAt: timeEntry.startedAt })
          .from(timeEntry)
          .where(and(where, counted))
          .orderBy(desc(timeEntry.startedAt))
          .limit(limit),
      )
    // The start of the day of the oldest start the probe reached, or the range's start when
    // the probe ran out. An aggregate, so SQLite computes it once rather than per entry.
    const window = db.$with('day_window').as(
      db
        .select({
          from: sql<number>`coalesce(max(cast(value as integer)), ${c.range.from})`.as(
            'window_from',
          ),
        })
        .from(sql`json_each(${dayStarts})`)
        .where(
          sql`cast(value as integer) <= (
            select case when count(*) < ${limit} then ${c.range.from}
              else min(${probe.startedAt}) end from ${probe}
          )`,
        ),
    )
    const entries = await db
      .with(probe, window)
      .select({
        id: timeEntry.id,
        userId: timeEntry.userId,
        projectId: timeEntry.projectId,
        description: timeEntry.description,
        ticket: timeEntry.ticket,
        startedAt: timeEntry.startedAt,
        stoppedAt: timeEntry.stoppedAt,
        windowFrom: window.from,
      })
      .from(window)
      .crossJoin(timeEntry)
      .where(and(entriesWhere(scope, c, row, sql`${window.from}`)!, counted))
    if (entries.length === 0) return dayPage([], input.after)
    const from = entries[0].windowFrom
    const narrowed = {
      ...c,
      a: { ...c.a, from: localDate(from, c.a.timeZone) },
      range: { ...c.range, from },
    }
    const page = dayPage(piecesOf(narrowed, entries, now), input.after)
    if (page.next || from === c.range.from) return page
  }
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

// The Entries card's list, from the pieces the export reads under getReport's rules, so both
// show the same entries and count a running timer alike. The server narrows, groups, and
// pages it, so a large organization's month stays a bounded response (docs/architecture/reports.md,
// "Report entries").
export async function getReportEntries(
  db: Database,
  scope: Scope,
  input: ReportEntriesInput,
  now = new Date(),
): Promise<ReportEntries> {
  let report = input.report
  // The pieces after a By day cursor are on its day or before.
  if (input.view === 'day' && input.after) {
    report = { ...report, to: [report.to, addDays(input.after.date, 1)].sort()[0] }
  }
  const c = await reportContext(db, scope, report, now)
  if (input.view === 'day') return { view: 'day', ...(await pagedDays(db, scope, c, input, now)) }
  const pieces = piecesOf(c, await listedEntries(db, scope, c, input.row), now)
  const rows = mergeByDescription(pieces)
  const offset = input.offset ?? 0
  const end = offset === 0 ? DESCRIPTION_PAGE_SIZE : rows.length
  return {
    view: 'description',
    rows: rows.slice(offset, end),
    rowCount: rows.length,
    next: end < rows.length ? end : null,
  }
}

// The Entries card's count and total for one timesheet part, without its list. The whole
// report's come with the report.
export async function getReportEntryTotals(
  db: Database,
  scope: Scope,
  input: ReportEntryTotalsInput,
  now = new Date(),
): Promise<{ count: number; total: number }> {
  const c = await reportContext(db, scope, input.report, now)
  const where = entriesWhere(scope, c, rowWhere(input.row, c.a.teams))
  const entries = where
    ? await db
        .select({ startedAt: timeEntry.startedAt, stoppedAt: timeEntry.stoppedAt })
        .from(timeEntry)
        .where(where)
    : []
  let count = 0
  let total = 0
  for (const entry of entries) {
    const span = countedSpan(entry, c.range, now.getTime())
    if (!span) continue
    count++
    total += span.to - span.from
  }
  return { count, total }
}
