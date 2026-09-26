// The seasonal copy (prototypes/seasons.js, prototypes/README.md, "Seasonal copy"): each
// season's sets of three intro lines, whose first two are the tagline on every page, sets for
// dates and date ranges, the taglines for a timesheet period's last days, and the intro's text
// colors. Every set follows one pattern: the season does something, then the timesheet does the
// same. docs/architecture.md, "Tagline", has the rules for which set shows.
import { type Accessor, createContext, useContext } from 'solid-js'
import { type IsoDate, addDays, localDate, monthDates } from '~/lib/calendar'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { type Season, seasonByMonth } from './scene'

type Line = () => string
type Lines = [Line, Line, Line]
type Locale = ReturnType<typeof getLocale>

// `title` and `sub` are the intro's headline and second line on the dark scene. `titleLight` is
// the headline's hue darkened for the tagline on light pages, at least 5:1 on the page, tint, and
// muted colors.
type SeasonCopy = {
  colors: { title: string; sub: string; titleLight: string }
  lines: Lines
  alternates: Lines[]
}

export const SEASON_COPY: Record<Season, SeasonCopy> = {
  // White and ice for snow.
  winter: {
    colors: { title: '#f4f8fd', sub: '#e6eef8', titleLight: '#2265b9' },
    lines: [m.season_winter_line_1, m.season_winter_line_2, m.season_winter_line_3],
    alternates: [
      [m.season_winter_alt_1_line_1, m.season_winter_alt_1_line_2, m.season_winter_alt_1_line_3],
    ],
  },
  // Fresh green and meltwater teal.
  spring: {
    colors: { title: '#cfeccb', sub: '#eef5ee', titleLight: '#33722a' },
    lines: [m.season_spring_line_1, m.season_spring_line_2, m.season_spring_line_3],
    alternates: [
      [m.season_spring_alt_1_line_1, m.season_spring_alt_1_line_2, m.season_spring_alt_1_line_3],
      [m.season_spring_alt_2_line_1, m.season_spring_alt_2_line_2, m.season_spring_alt_2_line_3],
      [m.season_spring_alt_3_line_1, m.season_spring_alt_3_line_2, m.season_spring_alt_3_line_3],
    ],
  },
  // Firefly yellow and green.
  summer: {
    colors: { title: '#f6e7a1', sub: '#f5f2e4', titleLight: '#76630b' },
    lines: [m.season_summer_line_1, m.season_summer_line_2, m.season_summer_line_3],
    alternates: [
      [m.season_summer_alt_1_line_1, m.season_summer_alt_1_line_2, m.season_summer_alt_1_line_3],
      [m.season_summer_alt_2_line_1, m.season_summer_alt_2_line_2, m.season_summer_alt_2_line_3],
    ],
  },
  // The leaves' amber and rust, lightened to read on the dark scene.
  autumn: {
    colors: { title: '#f6c07e', sub: '#f3e3d0', titleLight: '#94560a' },
    lines: [m.season_autumn_line_1, m.season_autumn_line_2, m.season_autumn_line_3],
    alternates: [
      [m.season_autumn_alt_1_line_1, m.season_autumn_alt_1_line_2, m.season_autumn_alt_1_line_3],
      [m.season_autumn_alt_2_line_1, m.season_autumn_alt_2_line_2, m.season_autumn_alt_2_line_3],
    ],
  },
}

// A set for some days in the user's zone, whatever the season, in one language when `locales`
// says so. `on` takes the local date.
type DatedLines = { lines: Lines; on: (date: IsoDate) => boolean; locales?: Locale[] }

function weekday(date: IsoDate) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

// From one month and day to another, inclusive, as 'MM-DD'.
function days(from: string, to = from) {
  return (date: IsoDate) => date.slice(5) >= from && date.slice(5) <= to
}

// The Monday after the month's last Sunday, the night the EU's clocks change.
function mondayAfterLastSunday(month: string) {
  return (date: IsoDate) => {
    const sunday = addDays(date, -1)
    return (
      weekday(date) === 1 &&
      sunday.slice(5, 7) === month &&
      addDays(sunday, 7).slice(5, 7) !== month
    )
  }
}

// Dates whose sets replace the tagline.
const DATES: DatedLines[] = [
  {
    lines: [m.tagline_new_year_1, m.tagline_new_year_2, m.tagline_new_year_3],
    on: days('01-02', '01-04'),
  },
  {
    lines: [m.tagline_leap_day_1, m.tagline_leap_day_2, m.tagline_leap_day_3],
    on: days('02-29'),
  },
  {
    lines: [m.tagline_clocks_forward_1, m.tagline_clocks_forward_2, m.tagline_clocks_forward_3],
    on: mondayAfterLastSunday('03'),
  },
  {
    lines: [m.tagline_midsummer_1, m.tagline_midsummer_2, m.tagline_midsummer_3],
    on: days('06-25', '06-27'),
    locales: ['et'],
  },
  {
    lines: [m.tagline_clocks_back_1, m.tagline_clocks_back_2, m.tagline_clocks_back_3],
    on: mondayAfterLastSunday('10'),
  },
  {
    lines: [m.tagline_halloween_1, m.tagline_halloween_2, m.tagline_halloween_3],
    on: days('10-31'),
  },
  {
    lines: [m.tagline_st_martins_1, m.tagline_st_martins_2, m.tagline_st_martins_3],
    on: days('11-10'),
    locales: ['et'],
  },
  {
    lines: [m.tagline_santa_1, m.tagline_santa_2, m.tagline_santa_3],
    on: days('12-20', '12-23'),
  },
  {
    lines: [m.tagline_santa_verse_1, m.tagline_santa_verse_2, m.tagline_santa_verse_3],
    on: days('12-20', '12-23'),
    locales: ['et'],
  },
]

// Date ranges whose sets join the season's in the daily turn.
const RANGES: DatedLines[] = [
  {
    lines: [m.tagline_holidays_1, m.tagline_holidays_2, m.tagline_holidays_3],
    on: days('07-01', '07-31'),
  },
  {
    lines: [m.tagline_school_en_1, m.tagline_school_en_2, m.tagline_school_en_3],
    on: days('09-01', '09-30'),
    locales: ['en'],
  },
  {
    lines: [m.tagline_school_et_1, m.tagline_school_et_2, m.tagline_school_et_3],
    on: days('09-01', '09-30'),
    locales: ['et'],
  },
  {
    lines: [m.tagline_elves_1, m.tagline_elves_2, m.tagline_elves_3],
    on: days('12-01', '12-19'),
    locales: ['et'],
  },
]

// Taglines for a timesheet period's last days, whatever the season.
export const PERIODS: Record<'weekEnd' | 'monthEnd', [Line, Line]> = {
  weekEnd: [m.tagline_week_end_1, m.tagline_week_end_2],
  monthEnd: [m.tagline_month_end_1, m.tagline_month_end_2],
}

const DAY = 86_400_000
// The month's last days that count as its end.
const MONTH_END_DAYS = 3

// When the copy is for. Without a zone, as on the sign-in page, only the season's own sets show.
type When = { now?: number; timeZone?: string; locale?: Locale }

function dated(sets: DatedLines[], date: IsoDate, locale: Locale) {
  return sets.filter((s) => s.on(date) && (!s.locales || s.locales.includes(locale)))
}

// One per UTC day, so the server and the browser pick the same one.
function inTurn<T>(sets: T[], now: number) {
  return sets[Math.floor(now / DAY) % sets.length]
}

// The intro's set for the day: the season's sets and the day's ranges, in turn.
export function seasonLines(season: Season, when: When = {}): Lines {
  const { now = Date.now(), timeZone, locale = getLocale() } = when
  const ranges = timeZone ? dated(RANGES, localDate(now, timeZone), locale) : []
  const { lines, alternates } = SEASON_COPY[season]
  return inTurn([lines, ...alternates, ...ranges.map((r) => r.lines)], now)
}

// The tagline's two lines: a date's set, else a period's on its last days (the month's last
// three, else Friday), else the first two of the intro's set.
export function taglineLines(season: Season, when: When = {}): [Line, Line] {
  const { now = Date.now(), timeZone, locale = getLocale() } = when
  if (timeZone) {
    const today = localDate(now, timeZone)
    const dates = dated(DATES, today, locale)
    if (dates.length > 0) {
      const [first, second] = inTurn(dates, now).lines
      return [first, second]
    }
    if (today >= addDays(monthDates(today).to, -MONTH_END_DAYS)) return PERIODS.monthEnd
    if (weekday(today) === 5) return PERIODS.weekEnd
  }
  const [first, second] = seasonLines(season, when)
  return [first, second]
}

export function introLines(season: Season, when: When = {}) {
  return seasonLines(season, when).map((line) => line())
}

// The season the page shows, which the frame provides from the Season setting. Without a frame,
// as in view tests, the month's.
const SeasonContext = createContext<Accessor<Season>>(() => seasonByMonth())
export const SeasonProvider = SeasonContext.Provider

export function useSeason() {
  return useContext(SeasonContext)
}

// The user's time zone, for the dated and period taglines. The frame provides it once the
// account's settings exist; without it, the tagline stays seasonal.
const TimeZoneContext = createContext<Accessor<string | undefined>>(() => undefined)
export const TimeZoneProvider = TimeZoneContext.Provider

export function useTimeZone() {
  return useContext(TimeZoneContext)
}
