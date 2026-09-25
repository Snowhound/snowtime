// The user's display formats (the durationFormat, dateFormat, and timeFormat settings) for
// the formatters in format.ts. Signed out, or before the settings load, the defaults apply.
import { useQuery } from '@tanstack/solid-query'
import { formatHours } from './format'
import { sessionQuery } from './session'

// The session's settings, read without fetching: the root keeps the session fresh, and a
// fetch as each row mounts would undo an optimistic settings change until the server answers.
function useSettings() {
  const session = useQuery(() => ({ ...sessionQuery, refetchOnMount: false }))
  return () => session.data?.settings
}

// formatHours in the user's duration format.
export function useFormatHours() {
  const settings = useSettings()
  return (ms: number) => formatHours(ms, settings()?.durationFormat)
}
