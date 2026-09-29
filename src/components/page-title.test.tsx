import { render, screen, waitFor } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, expect, test, vi } from 'vitest'
import { SeasonProvider, TaglineProvider } from '~/lib/scene/seasons'
import type { FillSummary } from '~/lib/taglines/fill'
import { PageTitle } from './page-title'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

// Noon on Tuesday 15 September 2026 in Tallinn, with yesterday filled but not today.
const OPEN: FillSummary = {
  date: '2026-09-15',
  timerStartedAt: null,
  today: 'open',
  lastWorkingDay: { date: '2026-09-14', filled: true },
  lastWeek: false,
  lastMonth: false,
  caughtUp: true,
  emptyDays: 0,
  streak: 1,
}

function renderTitle(initial: FillSummary) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T09:00:00Z'))
  const [fill, setFill] = createSignal(initial)
  render(() => (
    <SeasonProvider value={() => 'autumn'}>
      <TaglineProvider value={() => ({ show: true, timeZone: 'Europe/Tallinn', fill: fill() })}>
        <div class="relative">
          <PageTitle title="Timer" />
        </div>
      </TaglineProvider>
    </SeasonProvider>
  ))
  return setFill
}

function tagline() {
  return document.querySelector<HTMLElement>('.season-tagline')!
}

test('keeps its set when the summary changes while the page is open', () => {
  const setFill = renderTitle(OPEN)
  expect(screen.getByText("Yesterday's hours are all in.")).toBeInTheDocument()
  setFill({ ...OPEN, lastWorkingDay: { date: '2026-09-14', filled: false }, emptyDays: 1 })
  expect(screen.getByText("Yesterday's hours are all in.")).toBeInTheDocument()
})

test('switches to a praise set, with its cue, when a save fills today', async () => {
  // Shown before, so it gets no cue of its own.
  localStorage.setItem('snowtime.taglineSeen', "Yesterday's hours are all in. Lovely. And today's?")
  const setFill = renderTitle(OPEN)
  await waitFor(() => expect(tagline().dataset.placed).toBe(''))
  expect(tagline().dataset.cue).toBeUndefined()
  setFill({ ...OPEN, today: 'filled', streak: 2 })
  await waitFor(() => expect(tagline().dataset.cue).toBe(''))
  expect(screen.queryByText("Yesterday's hours are all in.")).not.toBeInTheDocument()
  expect(tagline().textContent).toMatch(/All caught up|A perfect timesheet/)
})

test('plays its cue again when clicked', async () => {
  localStorage.setItem('snowtime.taglineSeen', "Yesterday's hours are all in. Lovely. And today's?")
  renderTitle(OPEN)
  await waitFor(() => expect(tagline().dataset.placed).toBe(''))
  expect(tagline().dataset.cue).toBeUndefined()
  tagline().click()
  await waitFor(() => expect(tagline().dataset.cue).toBe(''))
})
