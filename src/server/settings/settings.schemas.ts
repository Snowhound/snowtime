import * as v from 'valibot'
import { APP_ICON_IDS } from '~/lib/app-icon'
import { validDurationPattern } from '~/lib/duration-pattern'
import { COUNTRIES } from '~/lib/holidays/region'
import { COLLECTION_IDS, IMAGE_IDS } from '~/lib/scene/images'
import { m } from '~/paraglide/messages.js'

// An IANA zone name such as Europe/Tallinn or UTC. Intl accepts the names the runtime
// knows; the pattern rejects the offsets ("+02:00") Intl also accepts, because an offset
// ignores daylight saving time.
const TimeZone = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z][\w+-]*(\/[\w+-]+)*$/, () => m.validation_time_zone_format()),
  v.check(
    (zone) => {
      try {
        // oxlint-disable-next-line no-new -- constructing it is the check: it throws on an unknown zone.
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
export type WeekStart = v.InferOutput<typeof WeekStart>

// UI languages; the first is the default (docs/architecture/platform.md, "Internationalization").
export const LOCALES = ['en', 'et'] as const
const Locale = v.picklist(LOCALES)
type Locale = v.InferOutput<typeof Locale>

// View settings, kept on the server so the first paint uses them (docs/architecture/timer.md,
// "User settings"). The first value of each list is the default.
export const THEMES = ['system', 'light', 'dark'] as const
export const Theme = v.picklist(THEMES)
export const TIMER_LAYOUTS = ['bar', 'focus', 'table'] as const
const TimerLayout = v.picklist(TIMER_LAYOUTS)
// The Timer page's entries as a list or a week calendar.
export const TIMER_VIEWS = ['list', 'calendar'] as const
const TimerView = v.picklist(TIMER_VIEWS)
// The brand concepts in src/lib/app-icon.ts; '02' is the default.
export const AppIcon = v.picklist(APP_ICON_IDS)
// The seasonal scene (prototypes/README.md, "Seasonal scene in the app"): the image collection,
// and an image of it pinned, or null to follow the calendar. The server checks that the pin is
// in the collection.
export const SceneCollection = v.picklist(COLLECTION_IDS)
export const ScenePin = v.nullable(v.picklist(IMAGE_IDS))
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
// Numeric dates, in the date fields: 30.09.2026 or 09/30/2026.
export const DATE_FORMATS = ['dmy', 'mdy'] as const
export const DateFormat = v.picklist(DATE_FORMATS)
export type DateFormat = v.InferOutput<typeof DateFormat>
// Clock times: 24-hour, or 12-hour with AM and PM.
export const TIME_FORMATS = ['24h', '12h'] as const
export const TimeFormat = v.picklist(TIME_FORMATS)
export type TimeFormat = v.InferOutput<typeof TimeFormat>
// How a duration is copied: a click on it, or a copy button beside it.
export const COPY_DURATION_CONTROLS = ['text', 'button'] as const
const CopyDurationControl = v.picklist(COPY_DURATION_CONTROLS)
// The text a copied duration becomes, such as `Hh Mm Ss` (src/lib/duration-pattern.ts).
const CopyDurationPattern = v.pipe(
  v.string(),
  v.check(validDurationPattern, () => m.validation_copy_duration_pattern()),
)
// Whose working days count for the taglines; null guesses from the time zone.
const Country = v.nullable(v.picklist(COUNTRIES))

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
  wideTimer: v.optional(v.boolean()),
  timerView: v.optional(TimerView),
  calendarWeekend: v.optional(v.boolean()),
  appIcon: v.optional(AppIcon),
  sceneCollection: v.optional(SceneCollection),
  scenePin: v.optional(ScenePin),
  sceneBackground: v.optional(v.boolean()),
  sceneStrength: v.optional(SceneStrength),
  surfaces: v.optional(Surfaces),
  sceneWeather: v.optional(v.boolean()),
  sceneIntro: v.optional(v.boolean()),
  sceneTagline: v.optional(v.boolean()),
  durationFormat: v.optional(DurationFormat),
  dateFormat: v.optional(DateFormat),
  timeFormat: v.optional(TimeFormat),
  copyDurationPattern: v.optional(CopyDurationPattern),
  copyDurationControl: v.optional(CopyDurationControl),
  country: v.optional(Country),
})
export type UpdateSettingsInput = v.InferOutput<typeof UpdateSettingsInput>
