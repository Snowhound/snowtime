import { describe, expect, test } from 'bun:test'
import { atLocalTime } from '~/lib/calendar'
import {
  addRange,
  clickRange,
  dragRange,
  instantAt,
  minutesInto,
  nudge,
  openingMinute,
  piecesOn,
  sideBySide,
  snap,
} from './week-grid'

const zone = 'Europe/Tallinn'
const MIN = 60_000

function at(date: string, time: string) {
  return atLocalTime(date, time, zone)
}

function entry(id: string, start: [string, string], end: [string, string] | null) {
  return {
    id,
    startedAt: new Date(at(...start)),
    stoppedAt: end && new Date(at(...end)),
  }
}

describe('minutesInto and instantAt', () => {
  test('read and write wall-clock minutes, past midnight too', () => {
    expect(minutesInto(at('2026-09-29', '09:30'), '2026-09-29', zone)).toBe(570)
    expect(minutesInto(at('2026-09-30', '01:00'), '2026-09-29', zone)).toBe(1500)
    expect(instantAt('2026-09-29', 570, zone)).toBe(at('2026-09-29', '09:30'))
    expect(instantAt('2026-09-29', 1440, zone)).toBe(at('2026-09-30', '00:00'))
    expect(instantAt('2026-09-29', -30, zone)).toBe(at('2026-09-28', '23:30'))
  })

  test('keep the hour lines on the days clocks change', () => {
    // Clocks spring forward from 03:00 to 04:00 on 29 March.
    expect(minutesInto(at('2026-03-29', '04:00'), '2026-03-29', zone)).toBe(240)
    expect(instantAt('2026-03-29', 3 * 60 + 30, zone)).toBe(at('2026-03-29', '04:30'))
  })
})

test('snap rounds to 15 minutes', () => {
  expect(snap(7)).toBe(0)
  expect(snap(8)).toBe(15)
  expect(snap(-8)).toBe(-15)
})

describe('piecesOn', () => {
  const now = at('2026-09-30', '12:00')

  test('splits an entry across midnight into a piece per day', () => {
    const cutover = entry('a', ['2026-09-23', '22:30'], ['2026-09-24', '01:20'])
    const [first] = piecesOn([cutover], '2026-09-23', zone, now)
    const [second] = piecesOn([cutover], '2026-09-24', zone, now)
    expect(first).toMatchObject({ top: 1350, bottom: 1440, first: true, last: false })
    expect(second).toMatchObject({ top: 0, bottom: 80, first: false, last: true })
    expect(first.to - first.from + second.to - second.from).toBe(170 * MIN)
  })

  test('runs a running entry to now', () => {
    const running = entry('r', ['2026-09-30', '11:00'], null)
    expect(piecesOn([running], '2026-09-30', zone, now)[0]).toMatchObject({
      top: 660,
      bottom: 720,
      last: true,
    })
  })

  test('places pieces by the wall clock on the days clocks change', () => {
    // 02:30 to 04:30 on 29 March is an hour long, from 02:30 to 04:30 on the grid.
    const spring = entry('s', ['2026-03-29', '02:30'], ['2026-03-29', '04:30'])
    const [piece] = piecesOn([spring], '2026-03-29', zone, now)
    expect(piece).toMatchObject({ top: 150, bottom: 270 })
    expect(piece.to - piece.from).toBe(60 * MIN)
    // 25 October is 25 hours long; its last hour ends at the bottom of the grid.
    const fall = entry('f', ['2026-10-25', '23:00'], ['2026-10-26', '00:00'])
    expect(piecesOn([fall], '2026-10-25', zone, now + 30 * 86_400_000)[0]).toMatchObject({
      top: 1380,
      bottom: 1440,
    })
    const pieces = ['2026-10-25', '2026-10-26'].flatMap((date) => piecesOn([fall], date, zone, now))
    expect(pieces.reduce((sum, p) => sum + p.to - p.from, 0)).toBe(60 * MIN)
  })
})

describe('sideBySide', () => {
  const now = at('2026-09-30', '12:00')
  function placed(...entries: ReturnType<typeof entry>[]) {
    return Object.fromEntries(
      sideBySide(piecesOn(entries, '2026-09-28', zone, now)).map((p) => [
        p.entry.id,
        [p.column, p.columns],
      ]),
    )
  }

  test('shares the width only among overlapping entries', () => {
    expect(
      placed(
        entry('a', ['2026-09-28', '09:00'], ['2026-09-28', '10:15']),
        entry('b', ['2026-09-28', '09:15'], ['2026-09-28', '10:15']),
        entry('c', ['2026-09-28', '09:30'], ['2026-09-28', '10:00']),
        entry('d', ['2026-09-28', '10:15'], ['2026-09-28', '11:00']),
      ),
    ).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] })
  })

  test('reuses a column freed within a cluster', () => {
    expect(
      placed(
        entry('a', ['2026-09-28', '09:00'], ['2026-09-28', '12:00']),
        entry('b', ['2026-09-28', '09:00'], ['2026-09-28', '10:00']),
        entry('c', ['2026-09-28', '10:00'], ['2026-09-28', '11:00']),
      ),
    ).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] })
  })
})

test('openingMinute opens at 07:00 or half an hour before the first entry', () => {
  expect(openingMinute([])).toBe(420)
  expect(openingMinute([{ top: 540 }])).toBe(420)
  expect(openingMinute([{ top: 400 }, { top: 600 }])).toBe(370)
  expect(openingMinute([{ top: 10 }])).toBe(0)
})

describe('clickRange and addRange', () => {
  const now = at('2026-09-29', '12:10')

  test('a click adds its half-hour cell, up to now', () => {
    expect(clickRange({ date: '2026-09-29', minutes: 9 * 60 + 20 }, zone, now)).toEqual({
      startedAt: at('2026-09-29', '09:00'),
      stoppedAt: at('2026-09-29', '09:30'),
    })
    // Just above the 09:30 line.
    expect(clickRange({ date: '2026-09-29', minutes: 9 * 60 + 26 }, zone, now)).toEqual({
      startedAt: at('2026-09-29', '09:30'),
      stoppedAt: at('2026-09-29', '10:00'),
    })
    expect(clickRange({ date: '2026-09-29', minutes: 12 * 60 + 5 }, zone, now)).toEqual({
      startedAt: at('2026-09-29', '12:00'),
      stoppedAt: now,
    })
    expect(clickRange({ date: '2026-09-29', minutes: 12 * 60 + 40 }, zone, now)).toBeNull()
    expect(clickRange({ date: '2026-09-28', minutes: 1439 }, zone, now)).toEqual({
      startedAt: at('2026-09-28', '23:30'),
      stoppedAt: at('2026-09-29', '00:00'),
    })
  })

  test('Add entry starts at the end of today’s last entry', () => {
    const entries = [
      entry('a', ['2026-09-29', '09:00'], ['2026-09-29', '10:45']),
      entry('b', ['2026-09-28', '15:00'], ['2026-09-28', '17:00']),
    ]
    expect(addRange(entries, zone, now)).toEqual({
      startedAt: at('2026-09-29', '10:45'),
      stoppedAt: at('2026-09-29', '11:15'),
    })
    expect(addRange(entries.slice(1), zone, now)).toEqual({
      startedAt: at('2026-09-29', '11:00'),
      stoppedAt: at('2026-09-29', '11:30'),
    })
  })
})

describe('dragRange', () => {
  const now = at('2026-09-29', '12:10')
  const stopped = { startedAt: at('2026-09-28', '09:00'), stoppedAt: at('2026-09-28', '10:30') }

  test('new time snaps, keeps 15 minutes, and stays on its day', () => {
    const drag = { kind: 'create', from: { date: '2026-09-28', minutes: 9 * 60 + 50 } } as const
    expect(dragRange(drag, { date: '2026-09-29', minutes: 8 * 60 + 5 }, zone, now)).toEqual({
      startedAt: at('2026-09-28', '08:00'),
      stoppedAt: at('2026-09-28', '09:45'),
    })
    expect(dragRange(drag, { date: '2026-09-28', minutes: 9 * 60 + 52 }, zone, now)).toEqual({
      startedAt: at('2026-09-28', '09:45'),
      stoppedAt: at('2026-09-28', '10:00'),
    })
  })

  test('new time stops at now, and can’t start after it', () => {
    const today = { kind: 'create', from: { date: '2026-09-29', minutes: 11 * 60 } } as const
    expect(dragRange(today, { date: '2026-09-29', minutes: 13 * 60 }, zone, now)).toEqual({
      startedAt: at('2026-09-29', '11:00'),
      stoppedAt: at('2026-09-29', '12:00'),
    })
    const later = { kind: 'create', from: { date: '2026-09-29', minutes: 13 * 60 } } as const
    expect(dragRange(later, { date: '2026-09-29', minutes: 14 * 60 }, zone, now).error).toBe(
      'add_future',
    )
  })

  test('a move shifts by days and snapped minutes, keeping the duration', () => {
    const drag = {
      kind: 'move',
      from: { date: '2026-09-28', minutes: 9 * 60 + 30 },
      ...stopped,
    } as const
    expect(dragRange(drag, { date: '2026-09-25', minutes: 10 * 60 + 35 }, zone, now)).toEqual({
      startedAt: at('2026-09-25', '10:00'),
      stoppedAt: at('2026-09-25', '11:30'),
    })
    expect(dragRange(drag, { date: '2026-09-29', minutes: 12 * 60 }, zone, now)).toMatchObject({
      startedAt: at('2026-09-29', '11:30'),
      error: 'future',
    })
  })

  test('a move keeps the wall-clock time across a change of clocks', () => {
    const drag = {
      kind: 'move',
      from: { date: '2026-03-27', minutes: 600 },
      startedAt: at('2026-03-27', '10:00'),
      stoppedAt: at('2026-03-27', '11:00'),
    } as const
    expect(dragRange(drag, { date: '2026-03-30', minutes: 600 }, zone, now)).toEqual({
      startedAt: at('2026-03-30', '10:00'),
      stoppedAt: at('2026-03-30', '11:00'),
    })
  })

  test('the edges change one end, keeping 15 minutes and stopping at now', () => {
    const from = { date: '2026-09-28', minutes: 600 }
    expect(
      dragRange(
        { kind: 'start', from, ...stopped },
        { date: '2026-09-28', minutes: 555 },
        zone,
        now,
      ),
    ).toEqual({ startedAt: at('2026-09-28', '08:15'), stoppedAt: stopped.stoppedAt })
    expect(
      dragRange(
        { kind: 'start', from, ...stopped },
        { date: '2026-09-28', minutes: 800 },
        zone,
        now,
      ),
    ).toEqual({ startedAt: at('2026-09-28', '10:15'), stoppedAt: stopped.stoppedAt })
    expect(
      dragRange({ kind: 'end', from, ...stopped }, { date: '2026-09-28', minutes: 660 }, zone, now),
    ).toEqual({ startedAt: stopped.startedAt, stoppedAt: at('2026-09-28', '11:30') })
    const today = { startedAt: at('2026-09-29', '11:00'), stoppedAt: at('2026-09-29', '11:30') }
    expect(
      dragRange({ kind: 'end', from, ...today }, { date: '2026-09-28', minutes: 780 }, zone, now),
    ).toEqual({ startedAt: today.startedAt, stoppedAt: now })
  })

  test('a running entry’s start stops 15 minutes before now', () => {
    const running = { startedAt: at('2026-09-29', '11:00'), stoppedAt: null }
    const from = { date: '2026-09-29', minutes: 660 }
    expect(
      dragRange(
        { kind: 'start', from, ...running },
        { date: '2026-09-29', minutes: 900 },
        zone,
        now,
      ),
    ).toEqual({ startedAt: now - 15 * MIN, stoppedAt: now })
  })
})

describe('nudge', () => {
  const now = at('2026-09-29', '12:10')
  const stopped = { startedAt: at('2026-09-28', '09:00'), stoppedAt: at('2026-09-28', '10:30') }

  test('moves by 15 minutes or a day, or changes the end with Shift', () => {
    expect(nudge(stopped, { minutes: -15, end: false }, zone, now)).toEqual({
      startedAt: at('2026-09-28', '08:45'),
      stoppedAt: at('2026-09-28', '10:15'),
    })
    expect(nudge(stopped, { days: -1, end: false }, zone, now)).toEqual({
      startedAt: at('2026-09-27', '09:00'),
      stoppedAt: at('2026-09-27', '10:30'),
    })
    expect(nudge(stopped, { minutes: 15, end: true }, zone, now)).toEqual({
      stoppedAt: at('2026-09-28', '10:45'),
    })
    expect(nudge(stopped, { days: 1, end: true }, zone, now)).toBeNull()
  })

  test('keeps an entry out of the future and 15 minutes long', () => {
    expect(nudge(stopped, { days: 1, end: false }, zone, now)).toEqual({
      startedAt: at('2026-09-29', '09:00'),
      stoppedAt: at('2026-09-29', '10:30'),
    })
    expect(nudge(stopped, { days: 2, end: false }, zone, now)).toEqual({ error: 'future' })
    const short = { startedAt: at('2026-09-28', '09:00'), stoppedAt: at('2026-09-28', '09:15') }
    expect(nudge(short, { minutes: -15, end: true }, zone, now)).toEqual({
      stoppedAt: short.stoppedAt,
    })
  })

  test('moves only a running entry’s start, up to a minute before now', () => {
    const running = { startedAt: at('2026-09-29', '12:00'), stoppedAt: null }
    expect(nudge(running, { minutes: -15, end: false }, zone, now)).toEqual({
      startedAt: at('2026-09-29', '11:45'),
    })
    expect(nudge(running, { minutes: 15, end: false }, zone, now)).toEqual({
      startedAt: now - MIN,
    })
    expect(nudge(running, { days: -1, end: false }, zone, now)).toBeNull()
    expect(nudge(running, { minutes: 15, end: true }, zone, now)).toBeNull()
  })
})
