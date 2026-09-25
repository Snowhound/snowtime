// Seasonal copy (task 031): the intro's three lines per season, whose first two are the tagline on
// every page, plus alternates and timesheet-period lines that the app may rotate in later, and the
// intro's text colors.
// `titleLight` is the headline's hue darkened for the tagline on light pages (at least 5:1 on the
// page, tint, and muted colors). The prototypes show each season's `lines` only. Load before
// scene.js, intro.js, and app-frame.js.
//
// The season is the `sceneSeason` user setting: 'auto' (by month) or one of the four.
//
// The lines follow one pattern: the season does something, then the timesheet does the same
// ("Winter is coming. So is the end of the month.").
;(() => {
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const SEASONS = {
    winter: {
      label: 'Winter',
      // The intro's headline and second line: white and ice for snow.
      colors: { title: '#f4f8fd', sub: '#e6eef8', titleLight: '#2265b9' },
      lines: ['Winter is coming.', 'So is the end of the month.', 'Before the snow gets deeper, fill in your timesheet.'],
      alternates: [],
    },
    spring: {
      label: 'Spring',
      // Fresh green and meltwater teal.
      colors: { title: '#cfeccb', sub: '#eef5ee', titleLight: '#33722a' },
      lines: ['The snow is melting.', 'So is your memory of last week.', "Before it's gone, fill in your timesheet."],
      alternates: [["Everything's growing.", 'So are your unlogged hours.', 'Before they grow any further, fill in your timesheet.']],
    },
    summer: {
      label: 'Summer',
      // Firefly yellow and green.
      colors: { title: '#f6e7a1', sub: '#f5f2e4', titleLight: '#76630b' },
      lines: ['The days are long.', "Your timesheet doesn't have to be.", "While the sun's still up, fill it in."],
      alternates: [['Summer is here.', "Your hours didn't go on holiday.", 'Before you do, fill in your timesheet.']],
    },
    autumn: {
      label: 'Autumn',
      // The leaves' amber and rust, lightened to read on the dark scene.
      colors: { title: '#f6c07e', sub: '#f3e3d0', titleLight: '#94560a' },
      lines: ['The leaves are falling.', 'So are your unlogged hours.', 'Before the last one lands, fill in your timesheet.'],
      alternates: [
        ['The nights are drawing in.', 'So is the deadline.', 'Before it gets dark, fill in your timesheet.'],
      ],
    },
  }
  // Taglines for a timesheet period's last days, whatever the season. Not shown in the prototypes.
  const PERIODS = {
    weekEnd: ["It's Friday.", 'So is the deadline.'],
    monthEnd: ['The month is almost out.', "Your hours shouldn't be."],
  }

  // The season by month, northern hemisphere.
  function byMonth(date = new Date()) {
    return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][date.getMonth()]
  }
  // The user's choice: 'auto' or a season.
  function chosen() {
    try {
      const season = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').sceneSeason
      return season in SEASONS ? season : 'auto'
    } catch {
      return 'auto'
    }
  }
  const current = () => (chosen() === 'auto' ? byMonth() : chosen())
  // The intro's lines.
  const introLines = (season = current()) => SEASONS[season].lines
  const tagline = (season = current()) => `${SEASONS[season].lines[0]} ${SEASONS[season].lines[1]}`
  // The tagline's two lines in the intro's colors, for an element with the `season-tagline` class
  // (prototype.css): the first in the headline color, the second in the second line's.
  function taglineHtml(season = current()) {
    const { lines, colors } = SEASONS[season]
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return `<span class="tagline-1" style="--tagline-title: ${colors.title}; --tagline-title-light: ${colors.titleLight}">${esc(lines[0])}</span> <span class="tagline-2" style="--tagline-sub: ${colors.sub}">${esc(lines[1])}</span>`
  }

  window.seasons = { SEASONS, PERIODS, SETTINGS_KEY, byMonth, chosen, current, introLines, tagline, taglineHtml }
})()
