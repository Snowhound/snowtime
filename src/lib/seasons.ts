// The seasonal copy (prototypes/seasons.js, prototypes/README.md, "Seasonal copy"): the intro's
// four lines per season, whose first two are the tagline on every page, plus alternates and
// timesheet-period taglines the app may rotate in later, and the intro's text colors. Every set
// follows one pattern: the season does something, then the timesheet does the same.
import { type Accessor, createContext, useContext } from 'solid-js'
import { m } from '~/paraglide/messages.js'
import { type Season, seasonByMonth } from './scene'

type Line = () => string
type Lines = [Line, Line, Line]

// `title`, `sub`, and `accent` are the intro's headline, second line, and last line on the dark
// scene. `titleLight` is the headline's hue darkened for the tagline on light pages, at least
// 5:1 on the page, tint, and muted colors.
type SeasonCopy = {
  colors: { title: string; sub: string; accent: string; titleLight: string }
  lines: Lines
  // Not shown yet.
  alternates: Lines[]
}

export const SEASON_COPY: Record<Season, SeasonCopy> = {
  // White and ice for snow.
  winter: {
    colors: { title: '#f4f8fd', sub: '#e6eef8', accent: '#b4d5f4', titleLight: '#2265b9' },
    lines: [m.season_winter_line_1, m.season_winter_line_2, m.season_winter_line_3],
    alternates: [],
  },
  // Fresh green and meltwater teal.
  spring: {
    colors: { title: '#cfeccb', sub: '#eef5ee', accent: '#9fd9c0', titleLight: '#33722a' },
    lines: [m.season_spring_line_1, m.season_spring_line_2, m.season_spring_line_3],
    alternates: [
      [m.season_spring_alt_1_line_1, m.season_spring_alt_1_line_2, m.season_spring_alt_1_line_3],
    ],
  },
  // Firefly yellow and green.
  summer: {
    colors: { title: '#f6e7a1', sub: '#f5f2e4', accent: '#d6ec8a', titleLight: '#76630b' },
    lines: [m.season_summer_line_1, m.season_summer_line_2, m.season_summer_line_3],
    alternates: [
      [m.season_summer_alt_1_line_1, m.season_summer_alt_1_line_2, m.season_summer_alt_1_line_3],
    ],
  },
  // The leaves' amber and rust, lightened to read on the dark scene.
  autumn: {
    colors: { title: '#f6c07e', sub: '#f3e3d0', accent: '#e8a062', titleLight: '#94560a' },
    lines: [m.season_autumn_line_1, m.season_autumn_line_2, m.season_autumn_line_3],
    alternates: [
      [m.season_autumn_alt_1_line_1, m.season_autumn_alt_1_line_2, m.season_autumn_alt_1_line_3],
    ],
  },
}

// Taglines for a timesheet period's last days, whatever the season. Not shown yet.
export const PERIODS: Record<'weekEnd' | 'monthEnd', [Line, Line]> = {
  weekEnd: [m.tagline_week_end_1, m.tagline_week_end_2],
  monthEnd: [m.tagline_month_end_1, m.tagline_month_end_2],
}

// The intro's four lines. The last is the sign-off: signed in, the one that answers the sign-in
// page's.
export function introLines(season: Season, signedIn: boolean) {
  return [
    ...SEASON_COPY[season].lines.map((line) => line()),
    signedIn ? m.intro_sign_off_signed_in() : m.intro_sign_off(),
  ]
}

// The season the page shows, which the frame provides from the Season setting. Without a frame,
// as in view tests, the month's.
const SeasonContext = createContext<Accessor<Season>>(() => seasonByMonth())
export const SeasonProvider = SeasonContext.Provider

export function useSeason() {
  return useContext(SeasonContext)
}
