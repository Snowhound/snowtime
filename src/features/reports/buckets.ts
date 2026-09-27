// A report's days and weeks as the views label them, and the part of a report the Entries
// card lists.
import type { IsoDate } from '~/lib/calendar'
import { formatIsoDate } from '~/lib/format'
import { m } from '~/paraglide/messages.js'
import type { Unit } from './filters'

// Short day labels up to a week; longer ranges show the day number alone.
const WEEK_DAYS = 7

export function longRange(unit: Unit, buckets: number) {
  return unit === 'day' && buckets > WEEK_DAYS
}

// A day or week in full, as screen readers and the Entries card name it.
export function bucketLabel(bucket: IsoDate, unit: Unit) {
  const date = formatIsoDate(bucket, { weekday: 'short', day: 'numeric', month: 'short' })
  return unit === 'week' ? m.reports_week_of({ date }) : date
}

// A column's label: the week's first day, or the day with its weekday up to a week.
export function shortBucketLabel(bucket: IsoDate, unit: Unit, buckets: number) {
  if (unit === 'week') return formatIsoDate(bucket, { day: 'numeric', month: 'short' })
  return formatIsoDate(
    bucket,
    longRange(unit, buckets) ? { day: 'numeric' } : { weekday: 'short', day: 'numeric' },
  )
}

// What the Entries card lists: a row, a day or week, or both.
export interface ReportPart {
  row?: string
  bucket?: IsoDate
}
