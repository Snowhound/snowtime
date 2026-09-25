// Typed dates and times for DatePicker and TimeInput (src/components/date-picker/): the text
// they show in the UI language, and what they read back from it. Values stay ISO dates
// ('2026-09-25') and 'HH:MM' times; only the text is localized. Pure, with the locale passed in.
import { type IsoDate, type WeekStart, addDays, startOfWeek } from './calendar'

type DatePart = 'day' | 'month' | 'year'

// One formatter per locale for dates and one for times: every date and time field formats
// with them as it renders, and building an Intl formatter is slow.
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const timeFormatters = new Map<string, Intl.DateTimeFormat>()

function cached(
  formatters: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  let f = formatters.get(locale)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options })
    formatters.set(locale, f)
  }
  return f
}

function dateFormatter(locale: string) {
  return cached(dateFormatters, locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function timeFormatter(locale: string) {
  return cached(timeFormatters, locale, { hour: '2-digit', minute: '2-digit' })
}

// The order of day, month, and year in the locale's numeric dates, and the separator
// between them: ['month', 'day', 'year'] and '/' for en, ['day', 'month', 'year'] and '.'
// for et.
export function dateFormat(locale: string): { order: DatePart[]; separator: string } {
  const parts = dateFormatter(locale).formatToParts(Date.UTC(2026, 10, 22))
  const order = parts
    .filter((p): p is Intl.DateTimeFormatPart & { type: DatePart } =>
      ['day', 'month', 'year'].includes(p.type),
    )
    .map((p) => p.type)
  const separator = parts.find((p) => p.type === 'literal')?.value.trim() || '/'
  return { order, separator }
}

// The ISO date as the locale writes it: 09/25/2026 in en, 25.09.2026 in et.
export function formatDateInput(date: IsoDate, locale: string): string {
  if (!date) return ''
  return dateFormatter(locale).format(Date.parse(`${date}T00:00:00Z`))
}

function isoDate(year: number, month: number, day: number): IsoDate | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1) return null
  return date.toISOString().slice(0, 10)
}

// Reads a typed date in the locale's order, with any separator: 25.9.2026, 25/09/26, or
// 25092026 in et. A missing year is this year and a two-digit one is 20xx. An ISO date
// works in every locale. Null when the text is not a date.
export function parseDateInput(text: string, locale: string, today: IsoDate): IsoDate | null {
  const value = text.trim()
  const iso = /^(\d{4})\D(\d{1,2})\D(\d{1,2})$/.exec(value)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const { order } = dateFormat(locale)
  let groups = value.split(/\D+/).filter(Boolean)
  // Digits alone, as a phone's number pad types them: two for each of day and month.
  if (groups.length === 1 && (value.length === 6 || value.length === 8)) {
    const yearLength = value.length - 4
    let at = 0
    groups = order.map((part) => {
      const length = part === 'year' ? yearLength : 2
      const group = value.slice(at, at + length)
      at += length
      return group
    })
  }
  if (groups.length < 2 || groups.length > 3) return null

  const fields = groups.length === 3 ? order : order.filter((p) => p !== 'year')
  const found: Partial<Record<DatePart, string>> = {}
  fields.forEach((part, i) => (found[part] = groups[i]))
  const year = found.year ?? today.slice(0, 4)
  if (year.length !== 2 && year.length !== 4) return null
  if (found.day!.length > 2 || found.month!.length > 2) return null
  return isoDate(
    year.length === 2 ? 2000 + Number(year) : Number(year),
    Number(found.month),
    Number(found.day),
  )
}

// Whether the locale writes times with AM and PM.
export function uses12Hours(locale: string): boolean {
  return timeFormatter(locale).resolvedOptions().hour12 === true
}

// The 'HH:MM' time as the locale writes it, as formatTime shows times: 09:30 AM in en, 09:30
// in et.
export function formatTimeInput(time: string, locale: string): string {
  if (!time) return ''
  const [h, min] = time.split(':').map(Number)
  return timeFormatter(locale).format(Date.UTC(2026, 0, 1, h, min))
}

// Reads a typed time: 9, 930, 0930, 9:30, 9.30, or 9 30, with an optional am or pm
// (9:30pm, 9.30 p.m.) in any locale. Null when the text is not a time.
export function parseTimeInput(text: string): string | null {
  const match = /^(\d{1,4})(?:(?:\s?[:.,]\s?|\s)(\d{2}))?\s*(?:([ap])\.?\s?m?\.?)?$/i.exec(
    text.trim(),
  )
  if (!match) return null
  const [, first, minutes, meridiem] = match
  let hours: number
  let mins: number
  if (minutes !== undefined) {
    if (first.length > 2) return null
    hours = Number(first)
    mins = Number(minutes)
  } else if (first.length <= 2) {
    hours = Number(first)
    mins = 0
  } else {
    hours = Number(first.slice(0, -2))
    mins = Number(first.slice(-2))
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    hours = (hours % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0)
  }
  if (hours > 23 || mins > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

// The time moved by `minutes`, wrapping around midnight.
export function shiftTime(time: string, minutes: number): string {
  const [h, min] = time.split(':').map(Number)
  const total = (((h * 60 + min + minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// The month's calendar as whole weeks from the week start, with the days of the months
// either side filling the first and last week. `month` is any date in it.
export function monthWeeks(month: IsoDate, weekStart: WeekStart): IsoDate[][] {
  const first = `${month.slice(0, 7)}-01`
  const weeks: IsoDate[][] = []
  let day = startOfWeek(first, weekStart)
  while (weeks.length === 0 || day.slice(0, 7) === first.slice(0, 7)) {
    const week: IsoDate[] = []
    for (let i = 0; i < 7; i++) {
      week.push(day)
      day = addDays(day, 1)
    }
    weeks.push(week)
  }
  return weeks
}

// The date moved by whole months, on the same day or the month's last one: Jan 31 plus one
// month is Feb 28.
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number)
  const index = y * 12 + m - 1 + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return isoDate(year, month, Math.min(d, last))!
}
