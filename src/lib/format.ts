import { getLocale } from '../paraglide/runtime.js'

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

// A total in hours and minutes, rounded to the minute: 12:05.
export function formatHours(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
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
