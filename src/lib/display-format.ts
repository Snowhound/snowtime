// The user's display formats (the durationFormat, dateFormat, and timeFormat settings) for
// the formatters in format.ts and date-input.ts. Signed out, before the settings load, or
// outside a query client, the defaults apply: 11:10, 30.09.2026, and 15:30.
import { type QueryClient, QueryClientContext, hashKey } from '@tanstack/solid-query'
import { createSignal, useContext } from 'solid-js'
import { getLocale } from '~/paraglide/runtime.js'
import type { DateFormat, TimeFormat } from '~/server/settings/settings.schemas'
import { formatHours } from './format'
import { sessionQuery } from './session'
import type { Settings } from './settings'

type SettingsSignal = () => Settings | null | undefined

// One signal per query client, following the cached session: every duration, date and time
// field reads the formats, and a query observer each made the timer's rows slow to render.
const signals = new WeakMap<QueryClient, SettingsSignal>()

function settingsSignal(client: QueryClient): SettingsSignal {
  let signal = signals.get(client)
  if (signal) return signal
  function read() {
    return client.getQueryData(sessionQuery.queryKey)?.settings
  }
  const [settings, setSettings] = createSignal(read())
  const hash = hashKey(sessionQuery.queryKey)
  client.getQueryCache().subscribe((event) => {
    if (event.query.queryHash === hash) setSettings(read())
  })
  signal = settings
  signals.set(client, signal)
  return signal
}

// The session's settings, read from the cache without fetching: the root keeps the session
// fresh, and an optimistic settings change shows at once.
function useSettings(): SettingsSignal {
  const client = useContext(QueryClientContext)?.()
  return client ? settingsSignal(client) : () => undefined
}

// The user's duration format.
export function useDurationFormat() {
  const settings = useSettings()
  return () => settings()?.durationFormat ?? 'clock'
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

// Intl's hour cycle for the time format: h23 for 15:30 (the default), h12 for 3:30 PM.
export function hourCycle(format: TimeFormat = '24h'): 'h23' | 'h12' {
  return format === '12h' ? 'h12' : 'h23'
}

// The hour cycle, for formatDateTime's options where a date shows with its time.
export function useHourCycle() {
  const settings = useSettings()
  return () => hourCycle(settings()?.timeFormat)
}

// The UI language with the hour cycle as its Unicode extension (en-u-hc-h23), which the time
// fields read and write times in.
export function useTimeLocale() {
  const cycle = useHourCycle()
  return () => `${getLocale()}-u-hc-${cycle()}`
}
