import * as v from 'valibot'
import { m } from '~/paraglide/messages.js'
import { TicketKey, Timestamp, Uuidv7 } from '../schemas'
import { WeekStart } from '../settings/settings.schemas'

// A calendar day such as 2026-09-24, read in the user's time zone.
export const IsoDate = v.pipe(
  v.string(),
  v.isoDate(() => m.validation_date_format()),
  v.check(
    (d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d),
    () => m.validation_date_unknown(),
  ),
)

export const REPORT_UNITS = ['day', 'week'] as const

// Longest range a report covers: a year of weeks, to keep one call's reads bounded.
export const MAX_REPORT_DAYS = 371

function days(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000
}

// Totals for the days from `from` up to but not including `to`, per day or per week,
// optionally of one member or of one team's current members, and of one project ('none' is
// time without a project). Totals per ticket come only with `tickets`, since only a report by
// ticket shows them and a year of them outweighs the rest of the report.
export const ReportInput = v.pipe(
  v.object({
    from: IsoDate,
    to: IsoDate,
    unit: v.optional(v.picklist(REPORT_UNITS), 'day'),
    userId: v.optional(Uuidv7),
    teamId: v.optional(Uuidv7),
    projectId: v.optional(v.union([Uuidv7, v.literal('none')])),
    tickets: v.optional(v.literal(true)),
  }),
  v.check(
    (i) => i.to > i.from,
    () => m.validation_range_end_before_start(),
  ),
  v.check(
    (i) => days(i.from, i.to) <= MAX_REPORT_DAYS,
    () => m.validation_range_too_long({ days: MAX_REPORT_DAYS }),
  ),
  v.check(
    (i) => !(i.userId && i.teamId),
    () => m.validation_member_or_team(),
  ),
)
export type ReportInput = v.InferOutput<typeof ReportInput>

// Longest piece of an export: a calendar month, so one response stays well under Vercel's
// 4.5 MB limit (docs/hosting.md).
const MAX_EXPORT_PIECE_DAYS = 31

// One piece of the report's export: its entries from `from` up to but not including `to`,
// inside the report's range. The first piece leaves out `now` and gets the report as well,
// counted up to the server's now, which the later pieces pass back as `now` so every piece
// and the report count a running entry up to the same moment.
export const ReportExportInput = v.pipe(
  v.object({ report: ReportInput, from: IsoDate, to: IsoDate, now: v.optional(Timestamp) }),
  v.check(
    (i) => i.to > i.from,
    () => m.validation_range_end_before_start(),
  ),
  v.check((i) => i.from >= i.report.from && i.to <= i.report.to),
  v.check(
    (i) => days(i.from, i.to) <= MAX_EXPORT_PIECE_DAYS,
    () => m.validation_range_too_long({ days: MAX_EXPORT_PIECE_DAYS }),
  ),
)
export type ReportExportInput = v.InferOutput<typeof ReportExportInput>

export const ENTRY_VIEWS = ['day', 'description'] as const

// Most day pieces in one page of the By day list.
export const ENTRY_PAGE_SIZE = 100

// By description's first page: its rows with the most time. The next page has the rest.
export const DESCRIPTION_PAGE_SIZE = 25

const RowId = v.union([Uuidv7, v.literal('none')])

// One timesheet row: a project, a team's current members, a member, or a ticket; 'none' is
// the "No project", "No team", or "No ticket" row.
const EntryRow = v.variant('group', [
  v.object({ group: v.literal('project'), id: RowId }),
  v.object({ group: v.literal('team'), id: RowId }),
  v.object({ group: v.literal('member'), id: Uuidv7 }),
  v.object({ group: v.literal('ticket'), id: v.union([TicketKey, v.literal('none')]) }),
])
export type EntryRow = v.InferOutput<typeof EntryRow>

// The report's entries for its Entries card, optionally of one timesheet row. A day or week
// of the timesheet narrows the report's range instead. By day comes a page at a time, each
// after the last piece of the one before; By description's second page starts at `offset`.
export const ReportEntriesInput = v.object({
  report: ReportInput,
  view: v.picklist(ENTRY_VIEWS),
  row: v.optional(EntryRow),
  after: v.optional(v.object({ date: IsoDate, userId: Uuidv7, from: v.number(), entryId: Uuidv7 })),
  offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
})
export type ReportEntriesInput = v.InferOutput<typeof ReportEntriesInput>

// The Entries card's count and total for one part of the timesheet.
export const ReportEntryTotalsInput = v.object({ report: ReportInput, row: v.optional(EntryRow) })
export type ReportEntryTotalsInput = v.InferOutput<typeof ReportEntryTotalsInput>

const Totals = v.object({
  total: v.number(),
  // Milliseconds per bucket, in the order of Report.buckets.
  perBucket: v.array(v.number()),
})
export type Totals = v.InferOutput<typeof Totals>

export const Report = v.object({
  ...Totals.entries,
  timeZone: v.string(),
  weekStart: WeekStart,
  unit: v.picklist(REPORT_UNITS),
  // The range as UTC instants; `to` is exclusive.
  from: Timestamp,
  to: Timestamp,
  // Running entries count up to this moment.
  now: Timestamp,
  // First day of each bucket: every day of the range, or the week start of each week it
  // touches. A partial first or last week counts only the days in the range.
  buckets: v.array(v.string()),
  // Days of the range with time, for the average per tracked day, which the buckets can't
  // give when they are weeks.
  trackedDays: v.number(),
  // Entries with time in the range; one that crosses midnight counts once.
  entries: v.number(),
  // Only rows with time, most time first. projectId null is time without a project, and
  // ticket null time without a ticket. Tickets only when the input asks for them.
  projects: v.array(v.object({ ...Totals.entries, projectId: v.nullable(v.string()) })),
  tickets: v.array(v.object({ ...Totals.entries, ticket: v.nullable(v.string()) })),
  members: v.array(v.object({ ...Totals.entries, userId: v.string() })),
  // A member in two teams counts in both, so team totals can add up to more than total.
  teams: v.array(v.object({ ...Totals.entries, teamId: v.string() })),
  // The members' names that the organization's member list lacks: people who have left it,
  // whose time still counts.
  formerMembers: v.array(v.object({ userId: v.string(), name: v.string(), email: v.string() })),
})
export type Report = v.InferOutput<typeof Report>

// Breakdown's second level: the range's time per project and member, and per ticket and
// member. Null is time without a project or ticket. Team, then member needs none: it comes
// from team membership and the report's member totals. Tickets only when the input asks.
export const ReportBreakdown = v.object({
  projects: v.array(
    v.object({ projectId: v.nullable(v.string()), userId: v.string(), total: v.number() }),
  ),
  tickets: v.array(
    v.object({ ticket: v.nullable(v.string()), userId: v.string(), total: v.number() }),
  ),
})
export type ReportBreakdown = v.InferOutput<typeof ReportBreakdown>

// One entry's time on one day of the range, for the Entries card: clipped to the range, split
// at the zone's midnights like the report's totals, and a running entry up to now.
export const ReportEntryPiece = v.object({
  entryId: v.string(),
  userId: v.string(),
  projectId: v.nullable(v.string()),
  description: v.string(),
  ticket: v.nullable(v.string()),
  date: v.string(),
  from: Timestamp,
  to: Timestamp,
  // The whole entry, which the card shows for a piece of an entry that crosses midnight.
  startedAt: Timestamp,
  stoppedAt: v.nullable(Timestamp),
  // The entry was running at `now`, so `to` is now, not its end.
  running: v.boolean(),
  ms: v.number(),
})
export type ReportEntryPiece = v.InferOutput<typeof ReportEntryPiece>

export const DescriptionRow = v.object({
  projectId: v.nullable(v.string()),
  ticket: v.nullable(v.string()),
  description: v.string(),
  total: v.number(),
  // How many entries and days the row merges, and who tracked it.
  entries: v.number(),
  days: v.number(),
  userIds: v.array(v.string()),
})
export type DescriptionRow = v.InferOutput<typeof DescriptionRow>

export const ReportEntries = v.variant('view', [
  v.object({
    view: v.literal('day'),
    // Each day's whole time in the list, also when the page holds only part of the day.
    days: v.array(v.object({ date: v.string(), total: v.number() })),
    pieces: v.array(ReportEntryPiece),
    next: v.nullable(
      v.object({ date: v.string(), userId: v.string(), from: v.number(), entryId: v.string() }),
    ),
  }),
  v.object({
    view: v.literal('description'),
    rows: v.array(DescriptionRow),
    // All the list's rows, of which the first page has the top DESCRIPTION_PAGE_SIZE.
    rowCount: v.number(),
    // The offset of the rows not yet sent: the next page sends them all.
    next: v.nullable(v.number()),
  }),
])
export type ReportEntries = v.InferOutput<typeof ReportEntries>

export const ReportEntryTotals = v.object({ count: v.number(), total: v.number() })

// A piece as the export lists it: it ends `ms` after `from`, and needs neither the whole
// entry nor its id.
const ExportEntry = v.pick(ReportEntryPiece, [
  'userId',
  'projectId',
  'description',
  'ticket',
  'date',
  'from',
  'running',
  'ms',
])
export type ExportEntry = v.InferOutput<typeof ExportEntry>

// One piece of the export; the first brings the report as well.
export const ReportExport = v.object({ report: v.optional(Report), entries: v.array(ExportEntry) })
