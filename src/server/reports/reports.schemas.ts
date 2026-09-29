import * as v from 'valibot'
import { m } from '~/paraglide/messages.js'
import { TicketKey, Uuidv7 } from '../schemas'

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
