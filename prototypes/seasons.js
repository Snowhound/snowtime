// Seasonal copy (task 031): the intro's four lines per season, whose first two are the tagline on
// every page, plus alternates and timesheet-period lines that the app may rotate in later. The
// prototypes show each season's `lines` only. Load before scene.js and app-frame.js.
//
// The lines follow one pattern: the season does something, then the timesheet does the same
// ("Winter is coming. So is the end of the month.").
;(() => {
  const VARIANTS_KEY = 'snowtime.prototypeAuthScene'
  const SIGN_OFF = 'Sign in and get it done!'
  const SEASONS = {
    winter: {
      label: 'Winter',
      lines: ['Winter is coming.', 'So is the end of the month.', 'Before the snow gets deeper, fill in your timesheet.', SIGN_OFF],
      alternates: [],
    },
    spring: {
      label: 'Spring',
      lines: ['The snow is melting.', 'So is your memory of last week.', "Before it's gone, fill in your timesheet.", SIGN_OFF],
      alternates: [["Everything's growing.", 'So are your unlogged hours.', 'Before they grow any further, fill in your timesheet.', SIGN_OFF]],
    },
    summer: {
      label: 'Summer',
      lines: ['The days are long.', "Your timesheet doesn't have to be.", "While the sun's still up, fill it in.", SIGN_OFF],
      alternates: [['Summer is here.', "Your hours didn't go on holiday.", 'Before you do, fill in your timesheet.', SIGN_OFF]],
    },
    autumn: {
      label: 'Autumn',
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

  // The season by month, northern hemisphere, unless the sign-in prototype's Season variant picks one.
  function byMonth(date = new Date()) {
    return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][date.getMonth()]
  }
  function current() {
    try {
      const season = JSON.parse(localStorage.getItem(VARIANTS_KEY) ?? '{}').season
      if (season in SEASONS) return season
    } catch {}
    return byMonth()
  }
  const tagline = (season = current()) => `${SEASONS[season].lines[0]} ${SEASONS[season].lines[1]}`

  window.seasons = { SEASONS, PERIODS, VARIANTS_KEY, byMonth, current, tagline }
})()
