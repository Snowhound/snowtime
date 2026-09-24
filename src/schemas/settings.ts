import * as v from 'valibot'

// An IANA zone name such as Europe/Tallinn or UTC. Intl accepts the names the runtime
// knows; the pattern rejects the offsets ("+02:00") Intl also accepts, because an offset
// ignores daylight saving time.
export const TimeZone = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z][\w+-]*(\/[\w+-]+)*$/, 'Use a time zone such as Europe/Tallinn.'),
  v.check((zone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      return true
    } catch {
      return false
    }
  }, 'Unknown time zone.'),
)

export const WeekStart = v.picklist(['mon', 'sun'])

// The browser's zone (Intl.DateTimeFormat().resolvedOptions().timeZone), used only when
// the user has no settings yet.
export const GetSettingsInput = v.object({ timeZone: TimeZone })
export type GetSettingsInput = v.InferOutput<typeof GetSettingsInput>

// Only the fields present change.
export const UpdateSettingsInput = v.object({
  timeZone: v.optional(TimeZone),
  weekStart: v.optional(WeekStart),
})
export type UpdateSettingsInput = v.InferOutput<typeof UpdateSettingsInput>
