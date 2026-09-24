import * as v from 'valibot'
import { m } from '../paraglide/messages.js'
import { Uuidv7 } from './common'

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
// optionally of one member or of one team's current members.
export const ReportInput = v.pipe(
  v.object({
    from: IsoDate,
    to: IsoDate,
    unit: v.optional(v.picklist(REPORT_UNITS), 'day'),
    userId: v.optional(Uuidv7),
    teamId: v.optional(Uuidv7),
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
