// The report's filters: the URL's search params, and what each role may choose
// (prototypes/README.md, reports.html). Members see their own time by project or ticket; team
// leads their led teams and those teams' members; admins and owners everyone. Anyone can narrow
// the report to one project. getReport enforces
// the same rules, so options outside them are dropped here rather than sent and refused.
import * as v from 'valibot'
import { type IsoDate, type WeekStart, addDays, startOfWeek } from '~/lib/calendar'
import type { Member } from '~/lib/queries/members'
import type { Team } from '~/lib/queries/teams'
import { m } from '~/paraglide/messages.js'
import {
  ENTRY_VIEWS,
  IsoDate as IsoDateSchema,
  REPORT_UNITS,
  type ReportEntriesInput,
  type ReportEntryTotalsInput,
  type ReportInput,
} from '~/server/reports/reports.schemas'
import { TicketKey, Uuidv7 } from '~/server/schemas'
import {
  MAX_DAY_COLUMNS,
  PRESETS,
  type Range,
  type RangePreset,
  rangeDays,
  resolveRange,
} from './range'

const GROUPS = ['project', 'ticket', 'team', 'member'] as const
export type Group = (typeof GROUPS)[number]
// The report's views, as tabs. Timesheet is the default and has no search param.
const VIEWS = ['timesheet', 'summary', 'breakdown'] as const
export type View = (typeof VIEWS)[number]
export type Unit = (typeof REPORT_UNITS)[number]
export type EntryView = (typeof ENTRY_VIEWS)[number]

// Each grouping's name: the filter bar's choice, the timesheet's first column, the export's.
export const GROUP_LABELS = {
  project: m.reports_group_project,
  ticket: m.reports_group_ticket,
  team: m.reports_group_team,
  member: m.reports_group_member,
} satisfies Record<Group, () => string>

// The title of each grouping's shares of the total, in Summary and a one-level Breakdown.
export const SHARE_TITLES = {
  project: m.reports_share_project,
  ticket: m.reports_share_ticket,
  team: m.reports_share_team,
  member: m.reports_share_member,
} satisfies Record<Group, () => string>

// A value that doesn't parse is dropped, so a bad link still opens a report.
function optional<T extends v.GenericSchema>(schema: T) {
  return v.fallback(v.optional(schema), undefined)
}

export const ReportSearch = v.object({
  range: optional(v.picklist([...PRESETS, 'custom'])),
  // The first and last day of a custom range, both included.
  from: optional(IsoDateSchema),
  to: optional(IsoDateSchema),
  team: optional(Uuidv7),
  member: optional(Uuidv7),
  // A project's ID, or 'none' for time without a project.
  project: optional(v.union([Uuidv7, v.literal('none')])),
  group: optional(v.picklist(GROUPS)),
  unit: optional(v.picklist(REPORT_UNITS)),
  view: optional(v.picklist(VIEWS.filter((view) => view !== 'timesheet'))),
  // The Entries card: the row and day or week it narrows to, and the list the user chose. A
  // filter or view change drops them.
  row: optional(v.union([Uuidv7, TicketKey, v.literal('none')])),
  bucket: optional(IsoDateSchema),
  entries: optional(v.picklist(ENTRY_VIEWS)),
})
export type ReportSearch = v.InferOutput<typeof ReportSearch>

// What the user may report on. Team leads aren't in the session: the teams' member roles
// tell which teams the user leads.
export type Access = { kind: 'member' } | { kind: 'lead'; teams: Team[] } | { kind: 'admin' }

function accessOf(userId: string, admin: boolean, teams: Team[]): Access {
  if (admin) return { kind: 'admin' }
  const led = teams.filter((t) => t.members.some((m) => m.userId === userId && m.role === 'lead'))
  return led.length ? { kind: 'lead', teams: led } : { kind: 'member' }
}

// The People select: the default (everyone, or the led teams), then teams, then members.
// Members get none: they only see their own time.
interface PeopleOptions {
  teams: Team[]
  members: Member[]
}

function peopleOptions(access: Access, userId: string, teams: Team[], members: Member[]) {
  if (access.kind === 'member') return null
  if (access.kind === 'admin') return { teams, members }
  const ids = new Set([userId, ...access.teams.flatMap((t) => t.members.map((m) => m.userId))])
  return {
    // One led team is the default itself, so it isn't listed again.
    teams: access.teams.length > 1 ? access.teams : [],
    members: members.filter((m) => ids.has(m.userId)),
  } satisfies PeopleOptions
}

export function groupOptions(access: Access): readonly Group[] {
  return access.kind === 'member' ? ['project', 'ticket'] : GROUPS
}

export interface ReportContext {
  today: IsoDate
  weekStart: WeekStart
  userId: string
  admin: boolean
  teams: Team[]
  members: Member[]
}

export interface ReportFilters {
  view: View
  preset: RangePreset
  range: Range
  unit: Unit
  group: Group
  team?: string
  member?: string
  project?: string
  access: Access
  people: PeopleOptions | null
  input: ReportInput
  entries: EntryFilters
}

// Longest span By day opens for; longer ones open By description.
const DAY_VIEW_DAYS = 7

export interface EntryFilters {
  view: EntryView
  // The timesheet part chosen, when it is one of the report's rows and buckets.
  row?: string
  bucket?: IsoDate
  input: Omit<ReportEntriesInput, 'after' | 'offset'>
  // The count and total of a narrowed list, which the report doesn't have; null for the
  // whole report's.
  totals: ReportEntryTotalsInput | null
  // The list can hold more than one person's entries, so it names them.
  many: boolean
}

function rangeAndUnit(search: ReportSearch, today: IsoDate, weekStart: WeekStart) {
  const { preset, range } = resolveRange(search, today, weekStart)
  const unit: Unit = rangeDays(range) > MAX_DAY_COLUMNS ? 'week' : (search.unit ?? 'day')
  return { preset, range, unit }
}

// The report the URL asks for, before the teams and members that tell what the user may
// choose have loaded, so the route can load it alongside them. It equals reportFilters'
// input unless the URL names a member or team outside the user's choices; the view then
// asks for the narrowed report, and getReport refuses this one.
export function requestedInput(
  search: ReportSearch,
  c: Pick<ReportContext, 'today' | 'weekStart'>,
): ReportInput {
  const { range, unit } = rangeAndUnit(search, c.today, c.weekStart)
  return {
    from: range.from,
    to: range.to,
    unit,
    ...(search.member ? { userId: search.member } : search.team ? { teamId: search.team } : {}),
    ...(search.project ? { projectId: search.project } : {}),
    ...(search.group === 'ticket' ? { tickets: true } : {}),
  }
}

// The filters the URL asks for, within what the user may choose.
export function reportFilters(search: ReportSearch, c: ReportContext): ReportFilters {
  const { preset, range, unit } = rangeAndUnit(search, c.today, c.weekStart)
  const access = accessOf(c.userId, c.admin, c.teams)
  const people = peopleOptions(access, c.userId, c.teams, c.members)
  const group =
    search.group && groupOptions(access).includes(search.group) ? search.group : 'project'
  const member = people?.members.some((m) => m.userId === search.member) ? search.member : undefined
  const team = !member && people?.teams.some((t) => t.id === search.team) ? search.team : undefined
  const input: ReportInput = {
    from: range.from,
    to: range.to,
    unit,
    ...(member ? { userId: member } : {}),
    ...(team ? { teamId: team } : {}),
    ...(search.project ? { projectId: search.project } : {}),
    ...(group === 'ticket' ? { tickets: true } : {}),
  }
  return {
    view: search.view ?? 'timesheet',
    preset,
    range,
    unit,
    group,
    team,
    member,
    project: search.project,
    access,
    people,
    input,
    entries: entryFilters(search, c, { access, group, range, unit, member, input }),
  }
}

// Whether the report has this row: any project or ticket, a team it counts (for admins also
// "No team"), or a member it may name, which for admins includes those who have left.
function hasRow(id: string, group: Group, access: Access, c: ReportContext) {
  if (group === 'ticket') return id === 'none' || v.is(TicketKey, id)
  if (group === 'project') return id === 'none' || v.is(Uuidv7, id)
  if (group === 'member') {
    if (access.kind === 'admin') return v.is(Uuidv7, id)
    return access.kind === 'lead' && c.members.some((m) => m.userId === id)
  }
  if (access.kind === 'admin') return id === 'none' || c.teams.some((t) => t.id === id)
  return access.kind === 'lead' && access.teams.some((t) => t.id === id)
}

function hasBucket(bucket: IsoDate, range: Range, unit: Unit, weekStart: WeekStart) {
  if (unit === 'day') return bucket >= range.from && bucket < range.to
  return (
    startOfWeek(bucket, weekStart) === bucket &&
    bucket < range.to &&
    addDays(bucket, 7) > range.from
  )
}

// The Entries card's list: the report's entries, or those of the timesheet part the URL names.
// A day or week narrows the range to its days in the report.
function entryFilters(
  search: ReportSearch,
  c: ReportContext,
  f: Pick<ReportFilters, 'access' | 'group' | 'range' | 'unit' | 'member' | 'input'>,
): EntryFilters {
  const row = search.row && hasRow(search.row, f.group, f.access, c) ? search.row : undefined
  const bucket =
    search.bucket && hasBucket(search.bucket, f.range, f.unit, c.weekStart)
      ? search.bucket
      : undefined
  const range = bucket
    ? {
        from: bucket < f.range.from ? f.range.from : bucket,
        to: [addDays(bucket, f.unit === 'week' ? 7 : 1), f.range.to].sort()[0],
      }
    : f.range
  const view = search.entries ?? (rangeDays(range) > DAY_VIEW_DAYS ? 'description' : 'day')
  const { tickets: _, ...report } = f.input
  const narrowed = {
    report: { ...report, from: range.from, to: range.to },
    // hasRow keeps 'none' out of the member group.
    ...(row ? { row: { group: f.group, id: row } } : {}),
  } as ReportEntryTotalsInput
  return {
    view,
    row,
    bucket,
    input: { ...narrowed, view },
    totals: row || bucket ? narrowed : null,
    many: f.access.kind !== 'member' && !f.member && !(row && f.group === 'member'),
  }
}
