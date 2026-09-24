import * as v from 'valibot'
import { Uuidv7 } from './common'

// A calendar day such as 2026-09-24, read in the user's time zone.
export const IsoDate = v.pipe(
  v.string(),
  v.isoDate('Use a date such as 2026-09-24.'),
  v.check((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Unknown date.'),
)

export const REPORT_UNITS = ['day', 'week'] as const

// Longest range a report covers: a year of weeks, to keep one call's reads bounded.
export const MAX_REPORT_DAYS = 371

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000

// Totals for the days from `from` up to but not including `to`, per day or per week,
// optionally of one member or of one team's current members.
export const ReportInput = v.pipe(
  v.object({
    from: IsoDate,
    to: IsoDate,
    unit: v.optional(v.picklist(REPORT_UNITS), 'day'),
    userId: v.optional(Uuidv7),
    teamId: v.optional(Uuidv7),
  }),
  v.check((i) => i.to > i.from, 'The range must end after it starts.'),
  v.check(
    (i) => days(i.from, i.to) <= MAX_REPORT_DAYS,
    `The range can span at most ${MAX_REPORT_DAYS} days.`,
  ),
  v.check((i) => !(i.userId && i.teamId), 'Pick a member or a team, not both.'),
)
export type ReportInput = v.InferOutput<typeof ReportInput>
