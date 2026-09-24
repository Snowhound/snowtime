// Seasonal copy (task 031): the intro's four lines per season, whose first two are the tagline on
// every page, plus alternates and timesheet-period lines that the app may rotate in later, and the
// intro's text colors. The prototypes show each season's `lines` only. Load before scene.js and
// app-frame.js.
//
// The season is the `sceneSeason` user setting: 'auto' (by month) or one of the four.
//
// The lines follow one pattern: the season does something, then the timesheet does the same
// ("Winter is coming. So is the end of the month.").
;(() => {
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const SIGN_OFF = 'Sign in and get it done!'
  const SEASONS = {
    winter: {
      label: 'Winter',
      // The intro's headline, second line, and last line: white and ice for snow.
      colors: { title: '#f4f8fd', sub: '#e6eef8', accent: '#b4d5f4' },
      lines: ['Winter is coming.', 'So is the end of the month.', 'Before the snow gets deeper, fill in your timesheet.', SIGN_OFF],
      alternates: [],
    },
    spring: {
      label: 'Spring',
      // Fresh green and meltwater teal.
      colors: { title: '#cfeccb', sub: '#eef5ee', accent: '#9fd9c0' },
      lines: ['The snow is melting.', 'So is your memory of last week.', "Before it's gone, fill in your timesheet.", SIGN_OFF],
      alternates: [["Everything's growing.", 'So are your unlogged hours.', 'Before they grow any further, fill in your timesheet.', SIGN_OFF]],
    },
    summer: {
      label: 'Summer',
      // Firefly yellow and green.
      colors: { title: '#f6e7a1', sub: '#f5f2e4', accent: '#d6ec8a' },
      lines: ['The days are long.', "Your timesheet doesn't have to be.", "While the sun's still up, fill it in.", SIGN_OFF],
      alternates: [['Summer is here.', "Your hours didn't go on holiday.", 'Before you do, fill in your timesheet.', SIGN_OFF]],
    },
    autumn: {
      label: 'Autumn',
      // The leaves' amber and rust, lightened to read on the dark scene.
      colors: { title: '#f6c07e', sub: '#f3e3d0', accent: '#e8a062' },
      lines: ['The leaves are falling.', 'So is the end of the month.', 'Before the last one lands, fill in your timesheet.', SIGN_OFF],
      alternates: [
        ['The leaves are falling.', 'So are your unlogged hours.', 'Before the last one lands, fill in your timesheet.', SIGN_OFF],
        ['The nights are drawing in.', 'So is the deadline.', 'Before it gets dark, fill in your timesheet.', SIGN_OFF],
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
  const tagline = (season = current()) => `${SEASONS[season].lines[0]} ${SEASONS[season].lines[1]}`

  window.seasons = { SEASONS, PERIODS, SETTINGS_KEY, byMonth, chosen, current, tagline }
})()
