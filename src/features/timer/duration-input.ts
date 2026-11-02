// A typed duration, for the entry popover's and the rows' duration fields
// (prototypes/copy-entries.html, "Duration field"): 1:30, 1:30:00, 1h 30m, 1h30, 90m, 90 min,
// 1.5, 1,5, and 1.5h, and the same with Estonian units (1 t 30 min). A bare number is hours.
// Only H:MM:SS keeps seconds; the other forms round to the minute.
import { m } from '~/paraglide/messages.js'
import { MAX_ENTRY_HOURS, MAX_ENTRY_MS } from '~/server/entries/entries.schemas'

const MINUTE = 60_000

export type DurationError = 'empty' | 'format' | 'too_short' | 'too_long' | 'bare_hours'

export type ParsedDuration =
  | { ms: number; error?: undefined }
  | { error: DurationError; ms?: undefined; text?: string }

const HOURS = '(?:h|hr|hrs|hours?|t|tundi?)'
const MINUTES = '(?:m|mins?|minutes?|minutit?)'
const CLOCK = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/
const UNITS = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${HOURS}\\s*(?:(\\d+)\\s*${MINUTES}?)?$`)
const ONLY_MINUTES = new RegExp(`^(\\d+)\\s*${MINUTES}$`)
const NUMBER = /^\d+(?:\.\d+)?$/

export function parseDuration(text: string): ParsedDuration {
  const typed = text.trim().toLowerCase().replace(',', '.')
  if (!typed) return { error: 'empty' }
  let ms: number
  let match: RegExpMatchArray | null
  if ((match = typed.match(CLOCK))) {
    const [, h, min, s] = match
    ms = ((Number(h) * 60 + Number(min)) * 60 + Number(s ?? 0)) * 1000
  } else if ((match = typed.match(UNITS))) {
    ms = Math.round(Number(match[1]) * 60 + Number(match[2] ?? 0)) * MINUTE
  } else if ((match = typed.match(ONLY_MINUTES))) {
    ms = Number(match[1]) * MINUTE
  } else if (NUMBER.test(typed)) {
    ms = Math.round(Number(typed) * 60) * MINUTE
  } else return { error: 'format' }
  if (ms < MINUTE) return { error: 'too_short' }
  if (ms > MAX_ENTRY_MS) {
    // "90" was meant as minutes more often than as hours.
    return /^\d+$/.test(typed) ? { error: 'bare_hours', text: typed } : { error: 'too_long' }
  }
  return { ms }
}

// A duration as the popover's field shows it once left: 1:30.
export function formatDurationInput(ms: number) {
  const minutes = Math.round(ms / MINUTE)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

const ERRORS: Record<DurationError, (text: string) => string> = {
  empty: () => m.duration_error_empty(),
  format: () => m.duration_error_format(),
  too_short: () => m.duration_error_too_short(),
  too_long: () => m.validation_entry_too_long({ hours: MAX_ENTRY_HOURS }),
  bare_hours: (hours) => m.duration_error_bare_hours({ hours }),
}

export function durationErrorMessage(parsed: ParsedDuration & { error: DurationError }) {
  return ERRORS[parsed.error](parsed.text ?? '')
}
