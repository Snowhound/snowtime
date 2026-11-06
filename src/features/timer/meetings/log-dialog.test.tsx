import { render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import { LogDialog } from './log-dialog'

const api = vi.hoisted(() => ({ listCalendarEvents: vi.fn() }))
vi.mock('~/lib/api/calendar', () => api)

function meeting(id: string, start: string, end: string, patch: Partial<CalendarEvent> = {}) {
  return {
    key: `google:anna@snowhound.eu:${id}`,
    seriesKey: null,
    sourceId: 'source-1',
    title: id,
    startedAt: new Date(start),
    stoppedAt: new Date(end),
    allDay: false,
    free: false,
    response: 'accepted',
    kind: 'event',
    ...patch,
  } satisfies CalendarEvent
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={queryClient}>
      <LogDialog
        open
        initial={{ from: '2026-11-03', to: '2026-11-03' }}
        organizationId="org-1"
        zone="Europe/Tallinn"
        region="EE"
        weekStart="monday"
        today="2026-11-03"
        now={Date.parse('2026-11-03T15:00:00Z')}
        projects={[]}
        suggest={() => null}
        entryKeys={new Set()}
        formatTime={(ms) => new Date(ms).toISOString().slice(11, 16)}
        onLog={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>
  ))
}

describe('LogDialog', () => {
  test("a day's checkbox checks, then unchecks, all its meetings", async () => {
    api.listCalendarEvents.mockResolvedValue({
      events: [
        meeting('Standup', '2026-11-03T07:30:00Z', '2026-11-03T07:45:00Z'),
        meeting('Review', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z', {
          response: 'declined',
        }),
      ],
      logs: [],
      connections: [],
    })
    renderDialog()
    const day = await screen.findByRole('checkbox', { name: /Tuesday/ })
    const standup = screen.getByRole('checkbox', { name: /Standup/ })
    const review = screen.getByRole('checkbox', { name: /Review/ })
    expect(day).toBePartiallyChecked()

    await userEvent.click(day)
    expect(standup).toBeChecked()
    expect(review).toBeChecked()
    expect(day).toBeChecked()

    await userEvent.click(day)
    expect(standup).not.toBeChecked()
    expect(review).not.toBeChecked()
    expect(day).not.toBeChecked()
  })
})
