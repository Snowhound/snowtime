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
  type Range,
  localDate,
  startOfDay,
} from '~/lib/calendar'
import { MAX_ENTRY_MS } from '../entries/entries.schemas'
import { AppError } from '../errors'
import { live } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
import {
  aggregate,
  type Aggregation,
  breakdownOf,
  dayPage,
  mergeByDescription,
  rangeOf,
  type ReportEntry,
} from './aggregation.server'
import {
  DESCRIPTION_PAGE_SIZE,
  ENTRY_PAGE_SIZE,
  type EntryRow,
  type ReportEntriesInput,
  type ReportEntryTotalsInput,
  type ReportExportInput,
  type ExportEntry,
  type Report,
  type ReportBreakdown,
  type ReportEntries,
  type ReportEntryPiece,
  type ReportInput,
} from './reports.schemas'

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
