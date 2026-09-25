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
import { AppError } from '../errors'
import { live } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
import type { ReportInput } from './reports.schemas'

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
// their current members.
async function reportTeams(db: Database, scope: Scope) {
  const teams = await db
    .select({ id: team.id })
    .from(team)
    .where(
      and(
        eq(team.organizationId, scope.organizationId),
        isAdmin(scope) ? undefined : inArray(team.id, scope.ledTeamIds),
      ),
    )
  if (teams.length === 0) return []
  const memberships = await db
    .select({ teamId: teamMember.teamId, userId: teamMember.userId })
    .from(teamMember)
    .where(
      inArray(
        teamMember.teamId,
        teams.map((t) => t.id),
      ),
    )
  return teams.map((t) => ({
    teamId: t.id,
    userIds: memberships.filter((m) => m.teamId === t.id).map((m) => m.userId),
  }))
}

// The users whose entries the report counts: the readable ones, narrowed to one member or
// to one team's current members. Null means everyone in the organization.
async function reportUsers(
  db: Database,
  scope: Scope,
  input: ReportInput,
  teams: { teamId: string; userIds: string[] }[],
): Promise<string[] | null> {
  const readable = await readableUserIds(db, scope)
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
// entries it may read that touch the range.
async function reportData(db: Database, scope: Scope, input: ReportInput, now: Date) {
  const settings = await settingsOf(db, scope.userId)
  const teams = await reportTeams(db, scope)
  const users = await reportUsers(db, scope, input, teams)
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
            startedAt: timeEntry.startedAt,
            stoppedAt: timeEntry.stoppedAt,
          })
          .from(timeEntry)
          .where(
            and(
              live(timeEntry, scope),
              users ? inArray(timeEntry.userId, users) : undefined,
              lt(timeEntry.startedAt, new Date(range.to)),
              or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, new Date(range.from))),
            ),
          )
  return { settings, a, range, entries }
}

export async function getReport(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now = new Date(),
): Promise<Report> {
  const { settings, a, range, entries } = await reportData(db, scope, input, now)
  return {
    ...aggregate(entries, a),
    timeZone: settings.timeZone,
    weekStart: settings.weekStart,
    unit: input.unit,
    from: new Date(range.from),
    to: new Date(range.to),
    now,
  }
}

// One entry's time on one day of the range, for the export's entry list: clipped to the
// range, split at the zone's midnights like the report's totals, and a running entry up to now.
export interface ReportEntryPiece {
  entryId: string
  userId: string
  projectId: string | null
  description: string
  date: IsoDate
  from: Date
  to: Date
  // The entry was running at `now`, so `to` is now, not its end.
  running: boolean
  ms: number
}

// The entries behind a report, oldest first, under the same rules as getReport, so their
// durations add up to its total.
export async function getReportEntries(
  db: Database,
  scope: Scope,
  input: ReportInput,
  now = new Date(),
): Promise<{ timeZone: string; entries: ReportEntryPiece[] }> {
  const { settings, range, entries } = await reportData(db, scope, input, now)
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
        date: piece.date,
        from: new Date(from),
        to: new Date(to),
        running: !entry.stoppedAt && to === now.getTime(),
        ms: piece.ms,
      })
      from = to
    }
  }
  pieces.sort((x, y) => x.from.getTime() - y.from.getTime() || x.entryId.localeCompare(y.entryId))
  return { timeZone: settings.timeZone, entries: pieces }
}
