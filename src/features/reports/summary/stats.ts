// Summary's line over the chart: the total and the average per tracked day.
import { type IsoDate, addDays, daysBetween } from '~/lib/calendar'
import type { Report } from '../queries'
import type { Range } from '../range'

export function summaryStats(
  report: Pick<Report, 'total' | 'trackedDays'>,
  range: Range,
  today: IsoDate,
) {
  // The range's days up to today, the ones time could be tracked on so far; more when time was
  // added ahead.
  const end = range.to < addDays(today, 1) ? range.to : addDays(today, 1)
  const days = Math.max(0, daysBetween(range.from, end), report.trackedDays)
  return {
    total: report.total,
    average: report.trackedDays ? report.total / report.trackedDays : 0,
    tracked: report.trackedDays,
    days,
  }
}
