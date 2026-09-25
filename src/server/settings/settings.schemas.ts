import * as v from 'valibot'
import { APP_ICON_IDS } from '~/lib/app-icon'
import { m } from '~/paraglide/messages.js'

// An IANA zone name such as Europe/Tallinn or UTC. Intl accepts the names the runtime
// knows; the pattern rejects the offsets ("+02:00") Intl also accepts, because an offset
// ignores daylight saving time.
export const TimeZone = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z][\w+-]*(\/[\w+-]+)*$/, () => m.validation_time_zone_format()),
  v.check(
    (zone) => {
      try {
        // Constructing the formatter is the check: it throws on an unknown zone.
        // oxlint-disable-next-line no-new
        new Intl.DateTimeFormat('en', { timeZone: zone })
        return true
      } catch {
        return false
      }
    },
    () => m.validation_time_zone_unknown(),
  ),
)

export const WeekStart = v.picklist(['mon', 'sun'])

// UI languages; the first is the default (docs/architecture.md, "Internationalization").
export const LOCALES = ['en', 'et'] as const
export const Locale = v.picklist(LOCALES)
export type Locale = v.InferOutput<typeof Locale>

// View settings, kept on the server so the first paint uses them (docs/architecture.md,
// "User settings"). The first value of each list is the default.
export const THEMES = ['system', 'light', 'dark'] as const
export const Theme = v.picklist(THEMES)
export const TIMER_LAYOUTS = ['bar', 'focus', 'table'] as const
export const TimerLayout = v.picklist(TIMER_LAYOUTS)
// The brand concepts in src/lib/app-icon.ts; '02' is the default.
export const AppIcon = v.picklist(APP_ICON_IDS)
// The seasonal scene (prototypes/README.md, "Seasonal scene in the app"). 'auto' picks the
// season by month.
export const SCENE_SEASONS = ['auto', 'winter', 'spring', 'summer', 'autumn'] as const
export const SceneSeason = v.picklist(SCENE_SEASONS)
// How much page color covers the background image.
export const SCENE_STRENGTHS = ['dimmed', 'full'] as const
export const SceneStrength = v.picklist(SCENE_STRENGTHS)
// Whether cards let the background show through.
export const SURFACES = ['glass', 'solid'] as const
export const Surfaces = v.picklist(SURFACES)

// How durations show: 11:10 or 11h 10m. Exports keep their own formats.
export const DURATION_FORMATS = ['clock', 'units'] as const
export const DurationFormat = v.picklist(DURATION_FORMATS)
export type DurationFormat = v.InferOutput<typeof DurationFormat>
// Numeric dates, in the date fields: by the UI language, 30.09.2026, or 09/30/2026.
export const DATE_FORMATS = ['auto', 'dmy', 'mdy'] as const
export const DateFormat = v.picklist(DATE_FORMATS)
export type DateFormat = v.InferOutput<typeof DateFormat>
// Clock times: by the UI language, 24-hour, or 12-hour with AM and PM.
export const TIME_FORMATS = ['auto', '24h', '12h'] as const
export const TimeFormat = v.picklist(TIME_FORMATS)
export type TimeFormat = v.InferOutput<typeof TimeFormat>

// The browser's zone (Intl.DateTimeFormat().resolvedOptions().timeZone) and the supported
// locale that best matches its languages, used only when the user has no settings yet.
export const GetSettingsInput = v.object({
  timeZone: TimeZone,
  locale: v.optional(Locale, LOCALES[0]),
})
export type GetSettingsInput = v.InferOutput<typeof GetSettingsInput>

// A partial patch: the UI saves one field at a time, and only the fields present change.
export const UpdateSettingsInput = v.object({
  timeZone: v.optional(TimeZone),
  weekStart: v.optional(WeekStart),
  locale: v.optional(Locale),
  theme: v.optional(Theme),
  timerLayout: v.optional(TimerLayout),
  showSummary: v.optional(v.boolean()),
  compactRows: v.optional(v.boolean()),
  appIcon: v.optional(AppIcon),
  sceneSeason: v.optional(SceneSeason),
  sceneBackground: v.optional(v.boolean()),
  sceneStrength: v.optional(SceneStrength),
  surfaces: v.optional(Surfaces),
  sceneWeather: v.optional(v.boolean()),
  sceneIntro: v.optional(v.boolean()),
  durationFormat: v.optional(DurationFormat),
  dateFormat: v.optional(DateFormat),
  timeFormat: v.optional(TimeFormat),
})
export type UpdateSettingsInput = v.InferOutput<typeof UpdateSettingsInput>
