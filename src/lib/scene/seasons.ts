// The seasonal copy (prototypes/seasons.js, prototypes/README.md, "Seasonal copy"): each
// season's sets of three intro lines, which are also the page tagline's fallback, and the
// intro's text colors. Every set follows one pattern: the season does something, then the
// timesheet does the same. The tagline's other sets are in src/lib/taglines/;
// docs/architecture.md, "Tagline", has the rules for which set shows.
import { type Accessor, createContext, useContext } from 'solid-js'
import type { FillSummary } from '~/lib/taglines/fill'
import { m } from '~/paraglide/messages.js'
import { type Locale, getLocale } from '~/paraglide/runtime.js'
import { type Season, seasonByMonth } from './scene'

type Line = (inputs?: object, options?: { locale?: Locale }) => string
type Lines = [Line, Line, Line]

// `title` and `sub` are the intro's headline and second line on the dark scene. `titleLight` is
// the headline's hue darkened for the tagline on light pages, at least 5:1 over the tinted scene
// images behind it as well as on the page and muted colors (task 065).
type SeasonCopy = {
  colors: { title: string; sub: string; titleLight: string }
  lines: Lines
  alternates: Lines[]
}

export const SEASON_COPY: Record<Season, SeasonCopy> = {
  // White and ice for snow.
  winter: {
    colors: { title: '#f4f8fd', sub: '#e6eef8', titleLight: '#0f4e99' },
    lines: [m.season_winter_line_1, m.season_winter_line_2, m.season_winter_line_3],
    alternates: [
      [m.season_winter_alt_1_line_1, m.season_winter_alt_1_line_2, m.season_winter_alt_1_line_3],
    ],
  },
  // Fresh green and meltwater teal.
  spring: {
    colors: { title: '#cfeccb', sub: '#eef5ee', titleLight: '#205a18' },
    lines: [m.season_spring_line_1, m.season_spring_line_2, m.season_spring_line_3],
    alternates: [
      [m.season_spring_alt_1_line_1, m.season_spring_alt_1_line_2, m.season_spring_alt_1_line_3],
      [m.season_spring_alt_2_line_1, m.season_spring_alt_2_line_2, m.season_spring_alt_2_line_3],
      [m.season_spring_alt_3_line_1, m.season_spring_alt_3_line_2, m.season_spring_alt_3_line_3],
    ],
  },
  // Firefly yellow and green.
  summer: {
    colors: { title: '#f6e7a1', sub: '#f5f2e4', titleLight: '#5e4d00' },
    lines: [m.season_summer_line_1, m.season_summer_line_2, m.season_summer_line_3],
    alternates: [
      [m.season_summer_alt_1_line_1, m.season_summer_alt_1_line_2, m.season_summer_alt_1_line_3],
      [m.season_summer_alt_2_line_1, m.season_summer_alt_2_line_2, m.season_summer_alt_2_line_3],
    ],
  },
  // The leaves' amber and rust, lightened to read on the dark scene.
  autumn: {
    colors: { title: '#f6c07e', sub: '#f3e3d0', titleLight: '#784100' },
    lines: [m.season_autumn_line_1, m.season_autumn_line_2, m.season_autumn_line_3],
    alternates: [
      [m.season_autumn_alt_1_line_1, m.season_autumn_alt_1_line_2, m.season_autumn_alt_1_line_3],
      [m.season_autumn_alt_2_line_1, m.season_autumn_alt_2_line_2, m.season_autumn_alt_2_line_3],
    ],
  },
}

const DAY = 86_400_000

// One per UTC day, so the server and the browser pick the same one.
export function inTurn<T>(sets: T[], now: number) {
  return sets[Math.floor(now / DAY) % sets.length]
}

// The season's sets in the order they take turns, in the language.
export function seasonSets(season: Season, locale: Locale = getLocale()) {
  const { lines, alternates } = SEASON_COPY[season]
  return [lines, ...alternates].map((set) => set.map((line) => line({}, { locale })))
}

// The intro's lines for the day: only the season's sets, in turn, since the intro opens the
// season. The page tagline picks its own (src/lib/taglines/).
export function introLines(season: Season, now = Date.now()) {
  return inTurn(seasonSets(season), now)
}

// The season the page shows, which the frame provides from the Season setting. Without a frame,
// as in view tests, the month's.
const SeasonContext = createContext<Accessor<Season>>(() => seasonByMonth())
export const SeasonProvider = SeasonContext.Provider

export function useSeason() {
  return useContext(SeasonContext)
}

// The page tagline's settings, which the frame provides from the account's: whether it shows,
// the user's zone for the catalogue's taglines, and the session's fill summary. Without a zone
// it stays seasonal.
type TaglineSettings = { show: boolean; timeZone?: string; fill?: FillSummary | null }
const TaglineContext = createContext<Accessor<TaglineSettings>>(() => ({ show: true }))
export const TaglineProvider = TaglineContext.Provider

export function useTagline() {
  return useContext(TaglineContext)
}
