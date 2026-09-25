import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import type { DurationFormat } from '~/server/settings/settings.schemas'

// Display formatting in the user's language and time zone. The server returns instants
// and milliseconds; only the client turns them into text (docs/architecture.md,
// "Internationalization").

// A running timer or an entry: 1:05:09.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

// A total in hours and minutes, rounded to the minute: 12:05, or with units (the
// durationFormat setting) 12h 5m, 12h, or 45m in the UI language.
export function formatHours(ms: number, format: DurationFormat = 'clock'): string {
  const total = Math.round(Math.max(0, ms) / 60_000)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (format === 'clock') return `${hours}:${String(minutes).padStart(2, '0')}`
  const text = !hours
    ? m.duration_minutes({ minutes })
    : !minutes
      ? m.duration_hours({ hours })
      : m.duration_hours_minutes({ hours, minutes })
  // Non-breaking spaces, so a duration never wraps in a narrow column.
  return text.replaceAll(' ', '\u00a0')
}

const formatters = new Map<string, Intl.DateTimeFormat>()

// An instant as a date or time in the zone, in the UI language. Formatters are cached,
// because building one is slow and lists format hundreds of values.
export function formatDateTime(
  ms: number | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const locale = getLocale()
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, ...options })
    formatters.set(key, formatter)
  }
  return formatter.format(ms)
}

export function formatTime(ms: number | Date, timeZone: string) {
  return formatDateTime(ms, timeZone, { hour: '2-digit', minute: '2-digit' })
}

// An ISO date such as 2026-09-24, which is a calendar day rather than an instant, so it is
// formatted in UTC to keep the same day in every zone.
export function formatIsoDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return formatDateTime(Date.parse(`${date}T00:00:00Z`), 'UTC', options)
}

// Two ISO dates as a range, such as "21–27 Sep 2026", in the UI language.
export function formatIsoDateRange(
  from: string,
  to: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const formatter = new Intl.DateTimeFormat(getLocale(), { timeZone: 'UTC', ...options })
  return formatter.formatRange(Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T00:00:00Z`))
}
