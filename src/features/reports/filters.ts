// The report's filters: the URL's search params, and what each role may choose
// (prototypes/README.md, reports.html). Members see their own time by project; team leads
// their led teams and those teams' members; admins and owners everyone. getReport enforces
// the same rules, so options outside them are dropped here rather than sent and refused.
import * as v from 'valibot'
import type { IsoDate, WeekStart } from '~/lib/calendar'
import type { Member } from '~/lib/members'
import type { Team } from '~/lib/teams'
import { IsoDate as IsoDateSchema, REPORT_UNITS } from '~/server/reports/reports.schemas'
import type { ReportInput } from '~/server/reports/reports.schemas'
import { Uuidv7 } from '~/server/schemas'
import {
  MAX_DAY_COLUMNS,
  PRESETS,
  type Range,
  type RangePreset,
  rangeDays,
  resolveRange,
} from './range'

export const GROUPS = ['project', 'team', 'member'] as const
export type Group = (typeof GROUPS)[number]
export type Unit = (typeof REPORT_UNITS)[number]

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
  group: optional(v.picklist(GROUPS)),
  unit: optional(v.picklist(REPORT_UNITS)),
})
export type ReportSearch = v.InferOutput<typeof ReportSearch>

// What the user may report on. Team leads aren't in the session: the teams' member roles
// tell which teams the user leads.
export type Access = { kind: 'member' } | { kind: 'lead'; teams: Team[] } | { kind: 'admin' }

export function accessOf(userId: string, admin: boolean, teams: Team[]): Access {
  if (admin) return { kind: 'admin' }
  const led = teams.filter((t) => t.members.some((m) => m.userId === userId && m.role === 'lead'))
  return led.length ? { kind: 'lead', teams: led } : { kind: 'member' }
}

// The People select: the default (everyone, or the led teams), then teams, then members.
// Members get none: they only see their own time.
export interface PeopleOptions {
  teams: Team[]
  members: Member[]
}

export function peopleOptions(access: Access, userId: string, teams: Team[], members: Member[]) {
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
  return access.kind === 'member' ? ['project'] : GROUPS
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
  preset: RangePreset
  range: Range
  unit: Unit
  group: Group
  team?: string
  member?: string
  access: Access
  people: PeopleOptions | null
  input: ReportInput
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
  return {
    preset,
    range,
    unit,
    group,
    team,
    member,
    access,
    people,
    input: {
      from: range.from,
      to: range.to,
      unit,
      ...(member ? { userId: member } : {}),
      ...(team ? { teamId: team } : {}),
    },
  }
}
