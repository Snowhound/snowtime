import { describe, expect, test } from 'bun:test'
import { type DayPage, type EntryPiece, entryDays, peopleLabel } from './entry-groups'

const HOUR = 3_600_000
const names: Record<string, string> = { a: 'Mart Kask', b: 'Kadri Tamm', c: 'Liis Mets', d: 'Ann' }
function nameOf(userId: string) {
  return names[userId]
}

function piece(entryId: string, userId: string, date: string, hour: number): EntryPiece {
  const from = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`)
  const to = new Date(from.getTime() + HOUR)
  return {
    entryId,
    userId,
    projectId: null,
    description: '',
    ticket: null,
    date,
    from,
    to,
    startedAt: from,
    stoppedAt: to,
    running: false,
    ms: HOUR,
  }
}

function page(pieces: EntryPiece[], days: [string, number][]): DayPage {
  return {
    view: 'day',
    days: days.map(([date, total]) => ({ date, total })),
    pieces,
    next: null,
  }
}

describe('entryDays', () => {
  test("lists a day's pieces by person name, each person's newest first", () => {
    const days = entryDays(
      [
        page(
          [
            piece('1', 'a', '2026-09-22', 9),
            piece('2', 'a', '2026-09-22', 14),
            piece('3', 'b', '2026-09-22', 10),
          ],
          [['2026-09-22', 3 * HOUR]],
        ),
      ],
      nameOf,
    )
    expect(days).toHaveLength(1)
    expect(days[0].pieces.map((p) => p.entryId)).toEqual(['3', '2', '1'])
  })

  test('for one person, a day lists the newest first', () => {
    const [day] = entryDays(
      [
        page(
          [piece('1', 'a', '2026-09-22', 9), piece('2', 'a', '2026-09-22', 14)],
          [['2026-09-22', 2 * HOUR]],
        ),
      ],
      null,
    )
    expect(day.pieces.map((p) => p.entryId)).toEqual(['2', '1'])
  })

  test('a day that continues on the next page shows once, with its whole total', () => {
    const days = entryDays(
      [
        page(
          [piece('1', 'a', '2026-09-23', 9), piece('2', 'a', '2026-09-22', 16)],
          [
            ['2026-09-23', HOUR],
            ['2026-09-22', 3 * HOUR],
          ],
        ),
        page(
          [piece('3', 'b', '2026-09-22', 9), piece('4', 'c', '2026-09-21', 9)],
          [
            ['2026-09-22', 3 * HOUR],
            ['2026-09-21', HOUR],
          ],
        ),
      ],
      nameOf,
    )
    expect(days.map((d) => [d.date, d.total, d.pieces.map((p) => p.entryId)])).toEqual([
      ['2026-09-23', HOUR, ['1']],
      ['2026-09-22', 3 * HOUR, ['3', '2']],
      ['2026-09-21', HOUR, ['4']],
    ])
  })
})

test('peopleLabel names up to three people, else two and a count', () => {
  expect(peopleLabel(['a', 'b', 'c'], nameOf)).toBe('Kadri Tamm, Liis Mets, and Mart Kask')
  expect(peopleLabel(['a', 'b', 'c', 'd'], nameOf)).toBe('Ann, Kadri Tamm and 2 more')
})
