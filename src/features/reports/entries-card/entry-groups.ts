// The Entries card's list from getReportEntries' pages. The server orders and pages the
// pieces; names are the client's, so it groups a day's pieces by person here.
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import type { ReportEntries } from '../queries'

export type DayPage = Extract<ReportEntries, { view: 'day' }>
export type EntryPiece = DayPage['pieces'][number]

export interface EntryDay {
  date: string
  total: number
  pieces: EntryPiece[]
}

// Each day once, newest first, with its whole total, also when it continues on the next page.
// With several people, a day lists each person's pieces together, by name; either way each
// person's newest first.
export function entryDays(pages: DayPage[], nameOf: ((userId: string) => string) | null) {
  const days = new Map<string, EntryDay>()
  for (const page of pages) {
    for (const { date, total } of page.days) {
      const day = days.get(date) ?? { date, total, pieces: [] }
      day.total = total
      days.set(date, day)
    }
    for (const piece of page.pieces) days.get(piece.date)?.pieces.push(piece)
  }
  const collator = new Intl.Collator(getLocale())
  for (const day of days.values()) {
    day.pieces.sort(
      (a, b) =>
        (nameOf ? collator.compare(nameOf(a.userId), nameOf(b.userId)) : 0) ||
        b.from.getTime() - a.from.getTime(),
    )
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
}

// Who tracked a By description row, by name: all of up to three, else two and a count.
export function peopleLabel(userIds: string[], nameOf: (userId: string) => string) {
  const names = userIds.map(nameOf).sort(new Intl.Collator(getLocale()).compare)
  if (names.length <= 3) {
    return new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(names)
  }
  return m.reports_entries_people_more({
    names: names.slice(0, 2).join(', '),
    count: names.length - 2,
  })
}
