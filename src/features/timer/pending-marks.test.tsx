import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, test, vi } from 'vitest'
import { CalendarStatus } from './calendar/calendar-status'
import { EntryActions } from './entry-list'
import type { Entry } from './queries'

const entry = {
  id: 'e1',
  organizationId: 'o1',
  userId: 'u1',
  projectId: null,
  description: 'Standup',
  ticket: null,
  startedAt: new Date('2026-10-07T08:30:00Z'),
  stoppedAt: new Date('2026-10-07T09:00:00Z'),
} satisfies Entry

test('a pending row shows Not saved over Try again in place of Saved', () => {
  const onRetry = vi.fn()
  render(() => (
    <EntryActions
      entry={entry}
      saved
      pending
      compact={false}
      active={false}
      onContinue={() => {}}
      onDelete={() => {}}
      onRetry={onRetry}
    />
  ))
  expect(screen.getByText('Not saved')).toBeInTheDocument()
  expect(screen.queryByText('Saved')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledOnce()
})

test('the calendar line offers Try again in Undo’s place while a change is pending', () => {
  const onRetry = vi.fn()
  render(() => (
    <CalendarStatus
      status={{ text: 'Moved “Standup”.', undo: () => {} }}
      pending
      onUndo={() => {}}
      onRetry={onRetry}
    />
  ))
  expect(screen.getByRole('status').textContent).toContain('Not saved yet: the server is busy.')
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledOnce()
})
