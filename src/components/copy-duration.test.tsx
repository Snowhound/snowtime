import { render, screen, waitFor } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { sessionQuery } from '~/lib/queries/session'
import { CopyAnnouncer, CopyDuration } from './copy-duration'

vi.mock('~/lib/api/auth', () => ({ getAppSession: vi.fn() }))

const MS = 2 * 3_600_000 + 5 * 60_000 + 9_000

// A duration with the session's copy settings; without a session, the defaults apply: H:MM:SS
// and a click on the duration.
function renderDuration(
  ms: number | null,
  settings: { copyDurationPattern?: string; copyDurationControl?: 'text' | 'button' } = {},
) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(sessionQuery.queryKey, { settings } as never)
  render(() => (
    <QueryClientProvider client={queryClient}>
      <CopyDuration ms={ms} label="2:05:09">
        2:05:09
      </CopyDuration>
      <CopyAnnouncer />
    </QueryClientProvider>
  ))
}

describe('CopyDuration', () => {
  test('copies the duration in the default pattern and shows what it copied', async () => {
    const user = userEvent.setup()
    renderDuration(MS)
    await user.click(screen.getByRole('button', { name: 'Copy duration 2:05:09' }))
    expect(await navigator.clipboard.readText()).toBe('2:05:09')
    expect(screen.getByRole('button')).toHaveTextContent('Copied 2:05:09')
    await waitFor(() =>
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Copied 2:05:09'),
    )
  })

  test("copies from the milliseconds in the user's pattern, not the shown text", async () => {
    const user = userEvent.setup()
    renderDuration(MS, { copyDurationPattern: 'M:SS' })
    await user.click(screen.getByRole('button', { name: 'Copy duration 2:05:09' }))
    expect(await navigator.clipboard.readText()).toBe('125:09')
  })

  test('says so when the browser refuses the clipboard', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    renderDuration(MS)
    await user.click(screen.getByRole('button', { name: 'Copy duration 2:05:09' }))
    expect(screen.getByRole('button')).toHaveTextContent("Couldn't copy")
  })

  test('with the button control, the text stays plain and the button beside it copies', async () => {
    const user = userEvent.setup()
    renderDuration(MS, { copyDurationControl: 'button' })
    const button = screen.getByRole('button', { name: 'Copy duration 2:05:09' })
    expect(button).not.toHaveTextContent('2:05:09')
    await user.click(button)
    expect(await navigator.clipboard.readText()).toBe('2:05:09')
  })

  test('is disabled without a duration', () => {
    renderDuration(null)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
