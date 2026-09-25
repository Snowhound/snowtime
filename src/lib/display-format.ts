// The user's display formats (the durationFormat, dateFormat, and timeFormat settings) for
// the formatters in format.ts and date-input.ts. Signed out, before the settings load, or
// outside a query client, the defaults apply: 11:10, 30.09.2026, and 15:30.
import { QueryClientContext, useQuery } from '@tanstack/solid-query'
import { useContext } from 'solid-js'
import type { DateFormat } from '~/server/settings/settings.schemas'
import { formatHours } from './format'
import { sessionQuery } from './session'
import type { Settings } from './settings'

// The session's settings, read without fetching: the root keeps the session fresh, and a
// fetch as each row mounts would undo an optimistic settings change until the server answers.
function useSettings(): () => Settings | null | undefined {
  if (!useContext(QueryClientContext)) return () => undefined
  const session = useQuery(() => ({ ...sessionQuery, refetchOnMount: false }))
  return () => session.data?.settings
}

// formatHours in the user's duration format.
export function useFormatHours() {
  const settings = useSettings()
  return (ms: number) => formatHours(ms, settings()?.durationFormat)
}

// A locale whose numeric dates are in the date format: day first with dots as Estonian
// writes them (the default), or month first with slashes as American English does. Only the
// order and separators of date-input.ts's numeric dates come from it.
export function dateLocale(format: DateFormat = 'dmy'): string {
  return format === 'mdy' ? 'en-US' : 'et'
}

// The locale the date fields read and write dates in.
export function useDateLocale() {
  const settings = useSettings()
  return () => dateLocale(settings()?.dateFormat)
}
