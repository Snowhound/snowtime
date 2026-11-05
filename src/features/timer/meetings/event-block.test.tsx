import { render, screen } from '@solidjs/testing-library'
import { describe, expect, test } from 'vitest'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import { AwayShade } from './event-block'

const away: CalendarEvent = {
  key: 'google:anna@snowhound.eu:away',
  seriesKey: null,
  sourceId: 'source-1',
  title: 'Out of office',
  startedAt: new Date('2026-11-02T22:00:00Z'),
  stoppedAt: new Date('2026-11-03T22:00:00Z'),
  allDay: false,
  free: false,
  response: 'accepted',
  kind: 'out_of_office',
}

function formatTime(ms: number) {
  return new Date(ms).toISOString().slice(11, 16)
}

describe('AwayShade', () => {
  test('a day off kept as midnight to midnight reads All day', () => {
    render(() => <AwayShade event={away} top={0} bottom={24 * 60} formatTime={formatTime} />)
    expect(screen.getByRole('button', { name: 'Out of office, All day' })).toBeInTheDocument()
  })

  test('a part of a day reads its times', () => {
    const afternoon = {
      ...away,
      startedAt: new Date('2026-11-03T11:00:00Z'),
      stoppedAt: new Date('2026-11-03T15:00:00Z'),
    }
    render(() => (
      <AwayShade event={afternoon} top={13 * 60} bottom={17 * 60} formatTime={formatTime} />
    ))
    expect(screen.getByRole('button', { name: 'Out of office, 11:00–15:00' })).toBeInTheDocument()
  })
})
