// Seasonal scene behind the sign-in page and the signed-in pages: a background image from the
// user's collection, in the page's theme, a tint that keeps text readable, and the image's WebGL
// weather effect. Winter's snow
// comes from design/backgrounds/snowtime_login_intro_with_backgrounds.html; the others follow its
// pattern.
// `scene.create()` returns a controller; `controller.el` is the element to place.
//
// The user's choices are settings in the shared prototype settings key (app-frame.js):
// `sceneCollection` and `scenePin` (see Collections below), `sceneBackground`, `sceneStrength` ('full',
// 'dimmed'), `sceneWeather`, and `sceneIntro` (whether the intro plays on its own; see intro.js),
// plus the app-wide `surfaces` ('glass', 'solid'): whether cards let a background show through.
// `scene.settings` reads and writes them for auth.html, which has no frame.
;(() => {
  const BASE = '../public/backgrounds/'
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const DEFAULTS = { sceneSeason: 'auto', sceneBackground: true, sceneStrength: 'dimmed', surfaces: 'glass', sceneWeather: true, sceneIntro: true }
  // The intro's lines and the tagline are in seasons.js; each image's weather is under "Weather by
  // image".
  const SEASONS = {
    winter: { label: 'Winter' },
    spring: { label: 'Spring' },
    summer: { label: 'Summer' },
    autumn: { label: 'Autumn' },
  }
  // --- Collections -------------------------------------------------------------------------------
  // A collection is the set of images the background follows through the year: by season (the four
  // mountain valleys) or by month (`images` in month order, task 062's MONTH_IMAGES). The user picks
  // one (`sceneCollection`) and can pin one of its images (`scenePin`, an image id, or null to follow
  // the calendar). The collection and image id name the files:
  // /backgrounds/<collection>/<id>-<theme>-<version>-<width>.avif.
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  function monthLabel(i, format = 'long') {
    return new Intl.DateTimeFormat('en', { month: format, timeZone: 'UTC' }).format(Date.UTC(2026, i, 15))
  }
  const COLLECTIONS = {
    mountains: { label: 'Mountain valley', description: 'Changes with the season', by: 'season', images: Object.keys(SEASONS) },
    countryside: { label: 'Baltic countryside', description: 'Changes every month', by: 'month', images: MONTHS.map((m) => `land-${m}`) },
    coast: { label: 'Baltic coast', description: 'Changes every month', by: 'month', images: MONTHS.map((m) => `coast-${m}`) },
  }
  const DEFAULT_COLLECTION = 'mountains'
  // --- Weather by image (task 066) ---------------------------------------------------------------
  // Each image's weather on light and dark pages: a preset below, tuned for the picture. All fields
  // but `effect` and `hint` are optional:
  // - `wind`: the sideways speed of the nearest items, in screen heights per second, positive to the
  //   right. Farther items move slower. Everything in the air moves with it, so seeds fly sideways in
  //   a wind that barely slants the rain.
  // - `gust` (0 to 1): how far the wind rises and falls around that speed.
  // - `shear`: how much stronger the wind gets below the horizon, as it picks up near the ground: at
  //   the screen's foot it's 1 + shear times the wind, so falling snow arcs toward the side.
  // - `amount`, `size`, `fall`, `opacity`: factors of the effect's item count, item size, falling
  //   speed, and opacity.
  // - `band`: [top, bottom], the rows the effect keeps to, as fractions of the image's height, so a
  //   mist stays on the water however the photo is cropped. Without a band the effect fills the
  //   screen.
  // - `share`: the share of special items: fluff among seeds, glints among midges. `glow`: how many
  //   fireflies fly apart from the midges.
  // - `zones`: up to four rectangles of the image, [left, top, right, bottom] as fractions of its
  //   width and height: where glitter lies, so it misses water (without them, the ground below the
  //   horizon), or where midges and fireflies keep. A fifth number scales glitter's opacity there.
  // - `tempo`: a factor of the effect's own motion: glitter's shimmer, the midges' flight, the
  //   fireflies' flight and glow, the stars' twinkle, the aurora's sway and drift.
  // - `shimmer`, `peaks`, `peakTime`, `peakSize`: glitter's faint shimmer, and how many full glints
  //   show at once, for how long, and how much larger.
  // - `colors`: in place of the effect's colors, with the same arguments.
  // - `count`, `seed`, `sky`, `moon`, `spread`: the stars, how many and the seed that places them,
  //   in the polygons of open sky ([x, y] points of the image) and out of the moon's circle ([x, y,
  //   radius in image heights]), and how much brighter the bright ones are than the faint (0 all
  //   the same). `peaks`, `peakTime`, and `peakSize` are their flashes, as glitter's glints.
  // - `curtains`: the aurora's, each `{ base, height, gain, lean }`: its lower edge through the
  //   `base` points, its height in image heights, its brightness, and how far its rays lean left
  //   per unit up.
  // Each image's horizon (HORIZONS) comes in too: glitter grows toward the viewer below it and shear
  // starts there. `effect: null` is no weather. `fps` is the preset's frame-rate target, by default
  // its effect's (task 063).
  // An image's entry names its preset and the fields it changes, and optionally a second entry
  // drawn over it (`also`, the third argument of wx()). weatherFor() merges them in that order: the
  // preset, then the image's horizon and fields, then weather.html's slider overrides, which tune
  // the first effect only.
  const PRESETS = {
    snow: { effect: 'snow', hint: 'falling snow' },
    flurries: { effect: 'snow', hint: 'a few snowflakes', amount: 0.22, size: 1.45, fall: 0.75 },
    // After Kait's weather prototype: fine grains, falling fast, in gusts, blown flatter near the
    // ground.
    blowing: { effect: 'snow', hint: 'blowing snow', fps: 60, amount: 2.2, size: 0.9, fall: 6, gust: 0.6, shear: 2.5 },
    // Droplets torn off the waves: a pixel or two, flying nearly flat.
    spray: { effect: 'snow', hint: 'sea spray', fps: 60, amount: 0.8, size: 0.4, fall: 2.5, gust: 0.9, shear: 1.5 },
    rain: { effect: 'rain', hint: 'a light shower' },
    squall: { effect: 'rain', hint: 'rain squalls', amount: 1.2, size: 1.35, fall: 1.25, gust: 0.8 },
    seeds: { effect: 'seeds', hint: 'drifting seeds' },
    // A few pixels across, for the open coast, where big tufts looked too near.
    'seeds-fine': { effect: 'seeds', hint: 'drifting seeds', size: 0.4 },
    motes: { effect: 'seeds', hint: 'motes in the sun', share: 0, size: 0.75, amount: 1.4, opacity: 0.8 },
    // Dust of a pixel, for a sunny day with nothing else in the air.
    'motes-fine': { effect: 'seeds', hint: 'dust in the sun', share: 0, size: 0.3, amount: 1.2, opacity: 0.85 },
    // Near-white, since sunlit dust is brighter than the hay behind it.
    dust: {
      effect: 'seeds',
      hint: 'dust in the sun',
      share: 0,
      size: 1.1,
      amount: 4,
      opacity: 1,
      gust: 0.4,
      colors: ({ dark, background }) => (dark || background ? [[1.0, 1.0, 0.97], [1.0, 0.99, 0.93]] : EFFECTS.seeds.colors({ dark, background })),
    },
    fireflies: { effect: 'fireflies', hint: 'fireflies' },
    midges: { effect: 'insects', hint: 'midges over the water', share: 0.25 },
    'midges-night': { effect: 'insects', hint: 'midges and fireflies', share: 0, glow: 2 },
    leaves: { effect: 'leaves', hint: 'falling leaves' },
    glitter: { effect: 'glitter', hint: 'glittering snow', opacity: 0.85 },
    // By day the glints need more size to show on the bright snow.
    'glitter-day': { effect: 'glitter', hint: 'glittering snow', size: 1.4, shimmer: 0.4, peakSize: 2.6 },
    frost: { effect: 'glitter', hint: 'glittering frost', opacity: 0.85 },
    'frost-day': { effect: 'glitter', hint: 'glittering frost', size: 1.4, shimmer: 0.4, peakSize: 2.6 },
    mist: { effect: 'mist', hint: 'drifting mist' },
    // The defaults Kait tuned in stars.html (task 076).
    stars: { effect: 'stars', hint: 'twinkling stars', opacity: 0.75, peaks: 0.4, peakTime: 1.2, peakSize: 1.6 },
    aurora: { effect: 'aurora', hint: 'northern lights', opacity: 0.95 },
    none: { effect: null, hint: 'still air' },
  }
  function wx(preset, tuning = {}, also) {
    return also ? { preset, ...tuning, also } : { preset, ...tuning }
  }
  // Each Baltic image's horizon, as a fraction of its height: where the sea, the ice, or the ground
  // meets the sky or the tree line. A recomposed image (task 065) updates these and the bands.
  const HORIZONS = {
    'coast-january': 0.38,
    'coast-february': 0.43,
    'coast-march': 0.51,
    'coast-april': 0.55,
    'coast-may': 0.53,
    'coast-june': 0.47,
    'coast-july': 0.74,
    'coast-august': 0.45,
    'coast-september': 0.48,
    'coast-october': 0.58,
    'coast-november': 0.43,
    'coast-december': 0.36,
    'land-january': 0.35,
    'land-february': 0.43,
    'land-march': 0.31,
    'land-april': 0.75,
    'land-may': 0.75,
    'land-june': 0.44,
    'land-july': 0.76,
    'land-august': 0.39,
    'land-september': 0.68,
    'land-october': 0.77,
    'land-november': 0.57,
    'land-december': 0.74,
  }
  // Where snow or frost lies in the glitter images, away from open water, where insects keep, and
  // where fog lies.
  const ZONES = {
    // Brighter on the ice than on the snowy shore.
    'coast-january-day': [
      [0, 0.4, 0.55, 0.82, 0.9],
      [0.55, 0.4, 1, 0.82, 1.25],
      [0, 0.82, 1, 1, 0.5],
    ],
    'coast-january': [
      [0, 0.4, 0.62, 0.82, 0.8],
      [0.62, 0.4, 0.92, 0.75, 1.2],
      [0, 0.82, 1, 1, 0.4],
      [0.74, 0.39, 0.8, 0.7, 1.6],
    ],
    // Fog over the bay and the far shore, low in the reeds right of the haystack, and thinner over
    // the near grass at the haystack's foot, so it stays off the haystack itself.
    'coast-september': [
      [0.25, 0.4, 1, 0.58, 1.2],
      [0.33, 0.5, 1, 0.78],
      [0, 0.72, 1, 0.97, 0.6],
    ],
    // The lake's snow away from the jetty, which doesn't glint. Each zone gets a third of the
    // specks, so the small second one, around the sun's and the moon's reflection, glints most.
    // The snow off the stream by night, glinting most in the moonlight under the moon, less over
    // the far field, on the bank and the bush right of the stream, and on the moon's reflection.
    'land-january': [
      [0.36, 0.35, 1, 0.47, 1.1],
      [0.58, 0.35, 0.74, 0.55, 1.5],
      [0.63, 0.47, 1, 0.66, 0.95],
      [0.59, 0.67, 0.69, 0.86, 1],
    ],
    'land-february': [
      [0, 0.46, 0.7, 0.62],
      [0.7, 0.46, 1, 0.8, 1.25],
      [0.36, 0.62, 1, 1],
    ],
    'land-november': [[0, 0.6, 1, 1]],
    // By night, midges mostly by the cliff, the rest over the river, and the fireflies on the far
    // bank. By day, all by the cliff, where they show.
    'land-july': [
      [0.05, 0.64, 0.33, 0.9],
      [0.34, 0.82, 0.88, 0.97],
      [0.58, 0.68, 1, 0.78],
    ],
    'land-july-day': [
      [0.05, 0.64, 0.33, 0.9],
      [0.05, 0.64, 0.33, 0.9],
    ],
  }
  // The mountain images' winds reproduce the drift each effect had before winds were per image.
  const MOUNTAIN_WIND = { snow: -0.02, rain: 0.22, seeds: 0.028, leaves: 0.026, fireflies: 0 }
  const mountain = (preset) => wx(preset, { wind: MOUNTAIN_WIND[preset] })
  // Early autumn's leaves, from land September's birches and rowans.
  // Coast seeds and motes on a light page with the picture, and wet snow by day: see weather.ts.
  const COAST_SPECKS = (s) => (s.dark || !s.background ? EFFECTS.seeds.colors(s) : [[0.7, 0.68, 0.62], [0.62, 0.52, 0.34]])
  const WET_SNOW = (s) => (s.dark || !s.background ? EFFECTS.snow.colors(s) : [[0.96, 0.97, 1], [0.64, 0.71, 0.8]])
  const BIRCH_LEAVES = ({ dark }) => (dark ? [[0.66, 0.54, 0.16], [0.6, 0.3, 0.12]] : [[0.84, 0.68, 0.18], [0.78, 0.36, 0.14]])
  const IMAGE_WEATHER = {
    winter: { light: mountain('snow'), dark: mountain('snow') },
    spring: { light: mountain('rain'), dark: mountain('rain') },
    summer: { light: mountain('seeds'), dark: mountain('fireflies') },
    autumn: { light: mountain('leaves'), dark: mountain('leaves') },
    'coast-january': {
      light: wx('glitter-day', { zones: ZONES['coast-january-day'], amount: 4, size: 2.3, opacity: 1.05, shimmer: 0.8, tempo: 1.3, peaks: 3.3, peakTime: 2.6, peakSize: 2.3 }),
      dark: wx('glitter', { zones: ZONES['coast-january'], amount: 1.33, size: 1.35, opacity: 0.75, shimmer: 0.72, tempo: 1, peaks: 5.1, peakTime: 3.2 }),
    },
    'coast-february': {
      light: wx('blowing', { amount: 0.55, size: 1.2, opacity: 1.3, fall: 2.35, wind: 0.2, gust: 1, shear: 5 }),
      dark: wx('blowing', { amount: 0.2, size: 1.15, opacity: 0.85, fall: 3, wind: -0.24 }),
    },
    // The wind comes off the sea, on the right, even on a calm day. By night, a clear sky under a
    // bright moon: stars in place of the flurries.
    'coast-march': {
      light: wx('flurries', { wind: -0.15, gust: 0.5, shear: 1, amount: 0.6, size: 1.4, fall: 1.3, colors: WET_SNOW }),
      dark: wx('stars', { count: 24, seed: 89, opacity: 0.6, sky: [[[0.02, 0.02], [0.98, 0.02], [0.98, 0.45], [0.9, 0.35], [0.75, 0.28], [0.62, 0.35], [0.6, 0.45], [0.02, 0.45]]], moon: [0.36, 0.29, 0.07] }),
    },
    // Sea fog below the moon, clear of the cliff, and stars away from the moon.
    'coast-april': {
      light: wx('motes-fine', { wind: -0.02, size: 0.9, opacity: 0.95, colors: COAST_SPECKS }),
      dark: wx('mist', { wind: -0.01, band: [0.48, 0.72], zones: [[0, 0.48, 0.68, 0.72]], opacity: 0.8 }, wx('stars', { count: 16, seed: 89, opacity: 0.5, sky: [[[0.02, 0.02], [0.64, 0.02], [0.66, 0.4], [0.02, 0.4]]], moon: [0.18, 0.36, 0.07] })),
    },
    // A bright early-summer night: stars in place of the seeds.
    'coast-may': {
      light: wx('seeds-fine', { wind: 0.03, amount: 0.6, colors: COAST_SPECKS }),
      dark: wx('stars', { count: 42, seed: 96, opacity: 0.5, spread: 0.8, sky: [[[0.22, 0.02], [0.98, 0.02], [0.98, 0.42], [0.22, 0.42]]] }),
    },
    'coast-june': { light: wx('seeds-fine', { wind: -0.08, gust: 0.4, colors: COAST_SPECKS }), dark: wx('seeds-fine', { wind: -0.08, gust: 0.4, amount: 0.75, opacity: 0.75 }) },
    // Fewer, slower fireflies under a moonless sky, so the two don't look busy together.
    'coast-july': {
      light: wx('seeds-fine', { wind: 0.03, colors: COAST_SPECKS }),
      dark: wx('fireflies', { amount: 0.18, tempo: 0.55 }, wx('stars', { sky: [[[0.02, 0.02], [0.98, 0.02], [0.98, 0.35], [0.85, 0.3], [0.8, 0.18], [0.65, 0.17], [0.6, 0.45], [0.02, 0.48]]] })),
    },
    // Stars above the clouds, out of the small moon's glow.
    'coast-august': {
      light: wx('motes', { wind: 0.008, colors: COAST_SPECKS }),
      dark: wx(
        'mist',
        { wind: 0.01, gather: 0.5, zones: [[0.34, 0.42, 1, 0.6, 0.8], [0.64, 0.41, 1, 0.47, 3]], amount: 2, size: 1.3, opacity: 1.2 },
        wx('stars', { count: 42, seed: 90, opacity: 0.4, sky: [[[0.15, 0.02], [0.98, 0.02], [0.98, 0.3], [0.5, 0.3], [0.5, 0.2], [0.15, 0.2]]], moon: [0.69, 0.345, 0.06] }),
      ),
    },
    'coast-september': {
      light: wx('seeds-fine', { wind: 0.16, gust: 0.5, fall: 0.5, size: 0.3, amount: 0.7, colors: COAST_SPECKS }),
      // Thick fog over the bay and the reed meadow, drifting the way the grass leans.
      dark: wx('mist', { wind: 0.012, zones: ZONES['coast-september'], amount: 1.6, size: 1.3, opacity: 1.1 }),
    },
    // The waves break from the right. By night, a few stars in the gaps between the clouds.
    'coast-october': {
      light: wx('squall', { wind: -0.6, amount: 1 }),
      dark: wx(
        'squall',
        { wind: -0.6, amount: 1 },
        wx('stars', { count: 10, seed: 85, opacity: 0.45, sky: [[[0.03, 0.02], [0.4, 0.02], [0.35, 0.1], [0.15, 0.2], [0.03, 0.2]], [[0.45, 0.01], [0.97, 0.01], [0.97, 0.06], [0.45, 0.06]]], moon: [0.6, 0.43, 0.08] }),
      ),
    },
    'coast-november': { light: wx('spray', { wind: -0.5, band: [0.3, 1.05] }), dark: wx('mist', { wind: -0.03, band: [0.32, 0.58] }) },
    // A few flakes blowing in off the sea, on the right.
    'coast-december': { light: wx('blowing', { wind: -0.2, amount: 0.12, size: 1.1, fall: 2.5, shear: 2, colors: WET_SNOW }), dark: wx('blowing', { wind: -0.2, amount: 0.06, size: 1.1, opacity: 0.7, fall: 2.5, shear: 2 }) },
    // Sparse snow on the stream by day; by night the moonlit snow glitters, as February's.
    'land-january': { light: wx('flurries'), dark: wx('glitter', { zones: ZONES['land-january'], amount: 1.33, size: 1.35, opacity: 0.85, shimmer: 0.72, tempo: 1.15, peaks: 5.1, peakTime: 2.8 }) },
    // Strong, or it doesn't show on the bright snow; very little snow instead if it still doesn't.
    'land-february': {
      light: wx('glitter-day', { zones: ZONES['land-february'], amount: 4, size: 2.8, opacity: 1.5, shimmer: 1, tempo: 1.7, peaks: 6, peakTime: 2.6, peakSize: 3 }),
      dark: wx('glitter', { zones: ZONES['land-february'], size: 1.35, opacity: 0.85, shimmer: 0.72, tempo: 1.15, peaks: 5.1, peakTime: 2.8 }),
    },
    'land-march': { light: wx('flurries', { wind: 0.06, gust: 0.4, shear: 0.5, amount: 0.5, size: 1.3, fall: 1.3, colors: WET_SNOW }), dark: wx('mist', { wind: 0.008, band: [0.3, 0.68], amount: 1.3, opacity: 1.3 }) },
    // Clear skies, as on the coast. By night, a few stars in the moonless sky right of the trees.
    'land-april': {
      light: wx('motes-fine', { wind: 0.01, size: 0.9, opacity: 0.95 }),
      dark: wx('mist', { wind: 0.006, zones: [[0, 0.67, 0.42, 0.79, 1.1], [0.35, 0.64, 0.78, 0.76, 0.6]], amount: 1.1, opacity: 0.75 }, wx('stars', { count: 5, seed: 96, sky: [[[0.54, 0.02], [0.99, 0.02], [0.99, 0.46], [0.54, 0.5]]] })),
    },
    // A bright early-summer night, so only a few stars.
    'land-may': {
      light: wx('seeds', { wind: 0.015, share: 0.5, amount: 2.5, size: 0.5 }),
      dark: wx('mist', { wind: 0.008, band: [0.66, 0.86] }, wx('stars', { count: 11, seed: 72, sky: [[[0.12, 0.02], [0.66, 0.02], [0.58, 0.3], [0.55, 0.55], [0.22, 0.55], [0.12, 0.3]]] })),
    },
    'land-june': {
      light: wx('seeds', { wind: 0.015, amount: 2.5, size: 0.6, opacity: 0.9, gust: 0 }),
      dark: wx('fireflies', { amount: 2.2, size: 0.5, opacity: 0.75 }),
    },
    'land-july': {
      light: wx('midges', { wind: 0.005, zones: ZONES['land-july-day'], amount: 1.95, tempo: 1.15 }),
      // Stars out of the bright moon's glow, low on the right.
      dark: wx('midges-night', { wind: 0.005, zones: ZONES['land-july'] }, wx('stars', { count: 50, seed: 75, sky: [[[0.23, 0.02], [0.98, 0.02], [0.98, 0.56], [0.29, 0.56], [0.25, 0.2]]], moon: [0.855, 0.48, 0.07] })),
    },
    'land-august': { light: wx('dust', { wind: 0.03 }), dark: wx('mist', { wind: 0.01, band: [0.32, 0.56] }) },
    'land-september': {
      light: wx('leaves', { wind: 0.07, gust: 0.5, amount: 0.15, colors: BIRCH_LEAVES }),
      dark: wx('mist', { wind: 0.008, band: [0.57, 0.9], amount: 1.4, size: 1.2 }),
    },
    // Smaller and fainter, so they sit in the tinted picture rather than in front of it.
    // By night, a few stars between the crescent moon and the small clouds.
    'land-october': {
      light: wx('leaves', { wind: 0.04, amount: 1.3, size: 0.7, opacity: 0.65 }),
      dark: wx(
        'leaves',
        { wind: 0.04, size: 0.7, opacity: 0.6, colors: () => [[0.42, 0.3, 0.18], [0.5, 0.44, 0.26]] },
        wx('stars', { count: 10, seed: 7, sky: [[[0.02, 0.02], [0.56, 0.02], [0.53, 0.58], [0.25, 0.58], [0.25, 0.44], [0.02, 0.42]]], moon: [0.245, 0.375, 0.05] }),
      ),
    },
    'land-november': {
      light: wx('frost-day', { zones: ZONES['land-november'], amount: 2.9, size: 2.4, opacity: 1.05, shimmer: 1, peaks: 2.9, peakTime: 2.6, peakSize: 3.1 }),
      // A moonless sky: stars in place of the frost, which barely caught light.
      dark: wx('stars', { count: 52, seed: 88, opacity: 0.6, sky: [[[0.17, 0.02], [0.86, 0.02], [0.84, 0.3], [0.81, 0.46], [0.17, 0.46]]] }),
    },
    'land-december': {
      light: wx('snow', { amount: 0.3, fall: 0.8 }),
      // A clear, moonless night: the aurora and stars in place of the snow, low on the left: a thin
      // band just over the treeline, a curtain above it whose edge bends down into a bright hook, a
      // faint arc over the hook, and a faint glow on the left.
      dark: wx(
        'aurora',
        {
          curtains: [
            { base: [[-0.036, 0.704], [0.096, 0.702], [0.204, 0.7], [0.276, 0.698], [0.324, 0.697]], height: 0.035, gain: 0.7 },
            { base: [[-0.036, 0.673], [0.096, 0.669], [0.192, 0.667], [0.258, 0.669], [0.3, 0.677], [0.326, 0.69], [0.341, 0.699]], height: 0.075, gain: 1, lean: 0.3 },
            { base: [[0.156, 0.588], [0.216, 0.6], [0.264, 0.614], [0.3, 0.63], [0.319, 0.642]], height: 0.035, gain: 0.28, lean: 0.3 },
            { base: [[-0.036, 0.648], [0.06, 0.642], [0.156, 0.638], [0.216, 0.64]], height: 0.05, gain: 0.3 },
          ],
        },
        wx('stars', { seed: 90, opacity: 0.5, sky: [[[0.02, 0.02], [0.7, 0.02], [0.68, 0.15], [0.62, 0.4], [0.57, 0.55], [0.02, 0.55]]] }),
      ),
    },
  }
  // The weather before task 066, for comparison on weather.html: one of the five effects per image,
  // blowing as it did on the mountains.
  const LEGACY_WEATHER = (() => {
    const W = (light, dark = light) => ({ light: mountain(light), dark: mountain(dark) })
    const coast = [W('snow'), W('snow'), W('snow'), W('rain'), W('seeds'), W('seeds'), W('seeds', 'fireflies'), W('seeds', 'fireflies'), W('seeds'), W('rain'), W('rain'), W('snow')]
    const land = [W('snow'), W('snow'), W('rain'), W('rain'), W('seeds'), W('seeds', 'fireflies'), W('seeds', 'fireflies'), W('seeds', 'fireflies'), W('leaves'), W('leaves'), W('snow'), W('snow')]
    return {
      ...Object.fromEntries(Object.keys(SEASONS).map((id) => [id, IMAGE_WEATHER[id]])),
      ...Object.fromEntries(coast.map((w, i) => [`coast-${MONTHS[i]}`, w])),
      ...Object.fromEntries(land.map((w, i) => [`land-${MONTHS[i]}`, w])),
    }
  })()
  // A replaced image's version, raised by one for both themes, so the week-long cache of public/
  // doesn't serve the old file; an id left out is version 1. Matches PHOTO_VERSIONS in scene.ts.
  const PHOTO_VERSIONS = Object.fromEntries(
    [
      ...['february', 'march', 'april', 'may', 'july', 'august', 'september', 'october', 'november', 'december'].map((m) => `coast-${m}`),
      ...['march', 'april', 'may', 'june', 'july', 'september', 'october', 'november', 'december'].map((m) => `land-${m}`),
    ].map((id) => [id, 2])
  )
  PHOTO_VERSIONS['land-december'] = 3
  function photoUrl(id, theme, width) {
    const version = String(PHOTO_VERSIONS[id] ?? 1).padStart(2, '0')
    return `${BASE}${image(id).collection}/${id}-${theme}-${version}-${width}.avif`
  }

  function image(id) {
    const [prefix, month] = String(id).split('-')
    const collection = Object.keys(COLLECTIONS).find((c) => COLLECTIONS[c].images.includes(id)) ?? DEFAULT_COLLECTION
    const i = MONTHS.indexOf(month)
    const season = i >= 0 ? seasons.byMonth(new Date(2026, i, 15)) : prefix in SEASONS ? prefix : 'winter'
    return {
      id,
      collection,
      label: i >= 0 ? monthLabel(i) : SEASONS[season].label,
      short: i >= 0 ? monthLabel(i, 'short') : SEASONS[season].label,
      month: i >= 0 ? i : null,
      season,
      weather: { light: weatherFor(id, 'light'), dark: weatherFor(id, 'dark') },
    }
  }
  // An image's weather in a theme, resolved: its preset, then the image's fields, then `overrides`,
  // and its second effect (`also`), which takes the image's horizon but not the overrides.
  // `legacy` reads the weather from before task 066.
  function weatherFor(id, theme, { legacy = false, overrides = null } = {}) {
    const { also, ...entry } = (legacy ? LEGACY_WEATHER : IMAGE_WEATHER)[id]?.[theme] ?? IMAGE_WEATHER.winter.light
    const weather = { ...PRESETS[entry.preset], horizon: HORIZONS[id], ...entry, ...overrides }
    if (!also) return weather
    const { also: _, ...second } = also
    return { ...weather, also: { ...PRESETS[second.preset], horizon: HORIZONS[id], ...second } }
  }
  // A resolved weather's hint: "drifting mist", or "drifting mist and twinkling stars" for a pair.
  function hintFor(weather) {
    return weather.also ? `${weather.hint} and ${weather.also.hint}` : weather.hint
  }
  // The stored choice. Without a collection, the old `sceneSeason` reads as a pinned mountain image.
  function collectionSetting(s) {
    if (s.sceneCollection in COLLECTIONS) {
      const pin = COLLECTIONS[s.sceneCollection].images.includes(s.scenePin) ? s.scenePin : null
      return { collection: s.sceneCollection, pin }
    }
    return { collection: DEFAULT_COLLECTION, pin: s.sceneSeason in SEASONS ? s.sceneSeason : null }
  }
  // The settings patch for a choice. `sceneSeason` stays in step for auth.html's Season select.
  function collectionPatch(collection, pin = null) {
    return { sceneCollection: collection, scenePin: pin, sceneSeason: pin in SEASONS ? pin : 'auto' }
  }
  // The image the calendar shows in a collection on `date`.
  function calendarImage(collection, date = seasons.today()) {
    const c = COLLECTIONS[collection] ?? COLLECTIONS[DEFAULT_COLLECTION]
    return c.by === 'month' ? c.images[date.getMonth()] : seasons.byMonth(date)
  }
  function imageFor(s, date) {
    const { collection, pin } = collectionSetting(s)
    return pin ?? calendarImage(collection, date)
  }
  // "Falling snow." or "Drifting seeds by day, fireflies at night." Without the background, the
  // season's.
  function weatherHint(id, background = true) {
    const { light, dark } = image(background ? id : image(id).season).weather
    const [day, night] = [hintFor(light), hintFor(dark)]
    const cap = (t) => t[0].toUpperCase() + t.slice(1)
    return day === night ? `${cap(day)}.` : `${cap(day)} by day, ${night} at night.`
  }

  // A 400 px version for pickers.
  function thumbUrl(id, theme) {
    return photoUrl(id, theme, 400)
  }

  // How much of the page color covers the image, dark / light.
  const STRENGTHS = {
    full: { label: 'Full', dark: 0.3, light: 0.2 },
    dimmed: { label: 'Dimmed', dark: 0.55, light: 0.4 },
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const isDark = () => document.documentElement.classList.contains('dark')

  const settings = {
    get() {
      try {
        const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
        return {
          sceneSeason: s.sceneSeason in SEASONS ? s.sceneSeason : 'auto',
          sceneCollection: collectionSetting(s).collection,
          scenePin: collectionSetting(s).pin,
          sceneBackground: s.sceneBackground !== false,
          sceneStrength: s.sceneStrength in STRENGTHS ? s.sceneStrength : DEFAULTS.sceneStrength,
          surfaces: s.surfaces === 'solid' ? 'solid' : 'glass',
          sceneWeather: s.sceneWeather !== false,
          sceneIntro: s.sceneIntro !== false,
        }
      } catch {
        return { ...DEFAULTS }
      }
    },
    set(patch) {
      try {
        const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...all, ...patch }))
      } catch {}
    },
  }
  const style = document.createElement('style')
  style.textContent = `
    .scene { position: absolute; inset: 0; overflow: hidden; pointer-events: none; background: var(--background); transition: background-color .6s ease; }
    /* The light and dark images are the same view at another time of day, so the theme change only
       crossfades them; a scale would make the mountains move. */
    .scene-photo { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0; transition: opacity .9s ease; }
    .scene[data-background='on'] .scene-photo-light { opacity: 1; }
    .dark .scene[data-background='on'] .scene-photo-light { opacity: 0; }
    .dark .scene[data-background='on'] .scene-photo-dark { opacity: 1; }
    /* The page color over the image, stronger toward the bottom, where the text sits. */
    .scene-tint { position: absolute; inset: 0; transition: background .8s ease;
      background: linear-gradient(180deg, color-mix(in srgb, var(--background) calc(var(--scene-tint) * 70%), transparent), color-mix(in srgb, var(--background) min(100%, calc(var(--scene-tint) * 115%)), transparent)); }
    .scene[data-background='off'] .scene-tint, .scene[data-background='off'] .scene-vignette { opacity: 0; }
    .scene-vignette { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, transparent 0 35%, rgb(0 0 0 / .14) 75%, rgb(0 0 0 / .32) 100%); transition: opacity .8s ease; }
    :root:not(.dark) .scene-vignette { background: radial-gradient(circle at 50% 50%, transparent 0 35%, rgb(216 227 239 / .28) 100%); }
    .scene canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; transition: opacity .5s ease; }
    .scene canvas[data-on] { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .scene, .scene * { transition: none !important; } }
  `
  document.head.append(style)

  // --- Weather: points in one draw call, positions computed in the vertex shader ----------------
  // The photos' aspect ratio and `background-position` y (.scene-photo), to map a band from image
  // rows to the screen the way `cover` crops the photo.
  const PHOTO_ASPECT = 1920 / 1084
  const PHOTO_Y = 0.5
  const FULL_BAND = [1.2, -1.2]
  // Quads per stretch of an aurora curtain between two of its points.
  const AURORA_STEPS = 24
  // Smooth value noise along a line, for the aurora's rays and patches.
  const VNOISE = `
  float vhash(float cell){ return float(lowbias32(uint(int(cell) + 65536))) / 4294967295.0; }
  float vnoise(float x){
    float i = floor(x), f = fract(x);
    f = f*f*(3.0 - 2.0*f);
    return mix(vhash(i), vhash(i + 1.0), f);
  }
  `
  // lowbias32 (Chris Wellons), an integer hash, for the stars and the aurora, as in the app.
  const HASH = `
  highp uint lowbias32(highp uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
  `
  // Every effect draws `count` points (or, with `quads`, two triangles each) with no buffers: each
  // item's randomness comes from gl_VertexID. Colors come from `colors({ dark, background })` as two
  // RGB triples; the image's tuning (see "Weather by image") comes in as uniforms.
  const HEAD = `#version 300 es
  precision highp float;
  uniform vec2 u_res;
  // The band's top and bottom in clip space; the full screen and a margin without a band.
  uniform vec2 u_band;
  // The image's horizon in clip space; below the screen without one.
  uniform float u_horizon;
  uniform float u_time, u_dpr, u_wind, u_gust, u_shear, u_size, u_fall, u_opacity, u_share, u_glow, u_tempo, u_gather;
  // Up to four rectangles of the image in clip space (left, top, right, bottom), and how many.
  uniform vec4 u_zones[4];
  uniform float u_zoneCount;
  // Each zone's factor of glitter's opacity.
  uniform vec4 u_zoneGain;
  vec4 zoneAt(float r){ return u_zones[int(min(floor(r * u_zoneCount), u_zoneCount - 1.0))]; }
  float hash(float n){ return fract(sin(n*127.1)*43758.5453123); }
  float hash2(float n){ return fract(sin(n*269.5+31.7)*17358.5453123); }
  // An integer hash for a falling item's column on each pass. The pass count grows without bound,
  // and sin() loses precision on large arguments, so hash() gave many items the same column.
  float columnHash(float pass){
    uint x = uint(gl_VertexID) * 1664525u + uint(pass) * 1013904223u + 12345u;
    x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
    return float(x) / 4294967295.0;
  }
  // The wind's strength now, around 1: gusts rise and fall with no fixed period.
  float gustNow(){ float t = u_time; return 1.0 + u_gust*(.6*cos(t*.7) + .4*cos(t*1.9+1.3)); }
  // The gusts' part of how far the wind has carried an item: the integral of gustNow, less its mean.
  float gustTime(){ float t = u_time; return u_gust*(.6*sin(t*.7)/.7 + .4*(sin(t*1.9+1.3) - sin(1.3))/1.9); }
  // The wind's speed in clip-space x per second, for an item at depth (1 for the nearest).
  float windSpeed(float depth){ return u_wind * depth * 2.0 * u_res.y / u_res.x; }
  // How far the wind has carried a floating item so far.
  float windX(float depth){ return windSpeed(depth) * (u_time + gustTime()); }
  // How much stronger the wind is at y: 1 down to the horizon, then rising to 1 + u_shear at the
  // screen's foot, as wind picks up near the ground.
  float shearAt(float y){
    if (u_horizon <= -1.0) return 1.0;
    float s = clamp((u_horizon - y) / (u_horizon + 1.0), 0.0, 1.0);
    return 1.0 + u_shear * s * s;
  }
  // How far the wind has carried a falling item since it entered at the band's top, falling v clip
  // units a second: the integral of shearAt along its path, which bends sideways below the horizon,
  // plus the gusts.
  float pathX(float y, float v, float depth){
    float below = max(0.0, u_horizon - y), h = max(u_horizon + 1.0, .01);
    return windSpeed(depth) * ((u_band.x - y + u_shear * below*below*below / (3.0*h*h)) / v + gustTime());
  }
  float wrapX(float x, float margin){ return -1.0 - margin + mod(x + 1.0 + margin, 2.0 + 2.0*margin); }
  // An item that starts r (0 to 1) down the band and has fallen d, wrapping within the band: its y,
  // and which pass it's on, so each pass can start in another column.
  vec2 fallPass(float r, float d){ float span = u_band.x - u_band.y, p = (1.0-r)*span + d; return vec2(u_band.x - mod(p, span), floor(p/span)); }
  // Fades items out at a band's edges, which are off-screen without a band.
  float bandFade(float y){ return clamp(min(u_band.x - y, y - u_band.y) / .12, 0.0, 1.0); }
  `
  const FS_HEAD = `#version 300 es
  precision highp float;
  uniform vec3 u_colorA, u_colorB;
  out vec4 outColor;
  `
  // Each effect's `density` is its item count per 1440 x 900 screen, within `min` and `max`, and
  // `fps` its presets' frame-rate target unless a preset sets its own: 60 for what moves far per
  // frame, 15 for the mist, which barely moves, else 30, since every frame also redraws the glass
  // surfaces' blur (task 063). The stars and the aurora place their items on the image instead
  // (`layout`).
  const EFFECTS = {
    // Snow, from the mock-up. A is the near flakes' color, B the far ones'.
    snow: {
      fps: 30,
      density: 500,
      min: 150,
      max: 900,
      vs: `${HEAD}
      out float v_alpha, v_depth, v_rnd;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
        float z = mix(.22, 1.0, pow(r3, 1.8));
        float v = .15 * mix(.18, .60, z) * u_fall * (1.0+r4*.55);
        vec2 f = fallPass(r2, u_time * v);
        float y = f.x;
        float x = columnHash(f.y) * 2.0 - 1.0 + pathX(y, v, mix(.6, 1.0, z));
        x += sin((y+r4*6.28)*4.5 + u_time*(.35+r3)) * (.008 + .035*(1.0-z));
        x = wrapX(x, .15);
        x *= mix(.88, 1.08, z);
        // The mock-up divided x by the aspect ratio, which left the sides of wide screens bare.
        gl_Position = vec4(x, y, 0.0, 1.0);
        gl_PointSize = max(1.0, 1.15 * u_dpr * mix(.8, 2.75, z) * u_size);
        v_alpha = mix(.15,.82,z) * mix(.72,1.0,r4) * u_opacity * bandFade(y);
        v_depth = z;
        v_rnd = r4;
      }`,
      fs: `${FS_HEAD}
      in float v_alpha, v_depth, v_rnd;
      void main() {
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.54,.22,d) * v_alpha;
        vec3 c = mix(u_colorB, u_colorA, v_depth) + v_rnd * 0.02;
        // Premultiplied, as the canvas composites; straight alpha would darken the flakes' edges.
        outColor = vec4(c * a, a);
        if (outColor.a < .02) discard;
      }`,
      // White on the dark scene and on the light image; on the plain light page white flakes would
      // vanish, so they turn blue-grey there.
      colors: ({ dark, background }) =>
        dark ? [[0.96, 0.98, 1.0], [0.66, 0.78, 0.9]] : background ? [[1.0, 1.0, 1.0], [0.9, 0.94, 0.98]] : [[0.44, 0.58, 0.69], [0.72, 0.83, 0.9]],
    },
    // Autumn: leaves that sway as they fall and tumble, each turning on its own. A is rust, B ochre.
    leaves: {
      fps: 60,
      density: 45,
      min: 20,
      max: 60,
      vs: `${HEAD}
      out float v_alpha, v_rnd, v_angle, v_flip;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
        float z = mix(.35, 1.0, pow(r3, 1.5));
        float t = u_time;
        float y = 1.25 - mod((1.25 - (r2*2.0-1.0)) + t * mix(.05, .12, z) * (.8 + r4*.5) * u_fall, 2.5);
        float swing = t * mix(1.0, 1.8, r5) + r4*6.28;
        // Drift with the wind, plus a pendulum sway that's wider for near leaves.
        float x = r1*2.0-1.0 + windX((.6+z)/1.6) + sin(swing) * mix(.03, .08, z) * u_res.y / u_res.x;
        x = wrapX(x, .15);
        gl_Position = vec4(x, y, 0.0, 1.0);
        gl_PointSize = u_dpr * mix(10.0, 26.0, z) * mix(.85, 1.15, r5) * u_size;
        v_angle = r1*6.28 + t*mix(-.7, .7, r2) + cos(swing)*.6;
        v_flip = cos(t*mix(.7, 1.8, r4) + r3*6.28);
        v_alpha = mix(.5, .95, z) * u_opacity;
        v_rnd = r5;
      }`,
      fs: `${FS_HEAD}
      in float v_alpha, v_rnd, v_angle, v_flip;
      void main() {
        vec2 q = (gl_PointCoord - .5) * 2.1;
        float c = cos(v_angle), s = sin(v_angle);
        q = mat2(c, -s, s, c) * q;
        float xr = q.x;
        // Tumbling: the leaf narrows as it turns edge-on.
        q.x /= mix(.3, 1.0, abs(v_flip));
        // A pointed leaf: where two offset circles overlap.
        float d = max(length(q - vec2(.5, 0.0)), length(q + vec2(.5, 0.0))) - 1.0;
        float fw = fwidth(d);
        float a = (1.0 - smoothstep(-fw, fw, d)) * v_alpha;
        vec3 col = mix(u_colorA, u_colorB, v_rnd);
        col *= mix(.7, 1.0, abs(v_flip));
        col = mix(col, col * 1.15 + .04, step(v_flip, 0.0) * .6);
        col *= 1.0 - .25 * (1.0 - smoothstep(.0, .05, abs(xr))) * step(abs(q.y), .8);
        outColor = vec4(col * a, a);
        if (outColor.a < .02) discard;
      }`,
      colors: ({ dark }) => (dark ? [[0.58, 0.27, 0.13], [0.7, 0.47, 0.18]] : [[0.71, 0.32, 0.15], [0.85, 0.58, 0.2]]),
    },
    // Summer nights: fireflies that wander over the meadow and glow on and off. A is the core, B the halo.
    fireflies: {
      fps: 30,
      density: 40,
      min: 18,
      max: 60,
      vs: `${HEAD}
      out float v_alpha;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
        float z = mix(.4, 1.0, r3);
        // Mostly low, over the meadow, a few up to the tree line.
        vec2 p = vec2(r1*2.0-1.0, mix(-.95, .3, pow(r2, 1.3)));
        float t = u_time * u_tempo * mix(.12, .22, r4);
        p += vec2(sin(t*2.1 + r4*6.28) + .5*sin(t*4.7 + r1*6.28), cos(t*1.7 + r5*6.28) + .5*sin(t*3.9 + r2*6.28)) * vec2(.06, .05);
        gl_Position = vec4(p, 0.0, 1.0);
        // A quick glow, a slower fade, then dark for the rest of the cycle.
        float ph = fract(u_time * u_tempo / mix(3.0, 6.0, r5) + r1);
        float glow = smoothstep(0.0, .12, ph) * (1.0 - smoothstep(.18, .6, ph));
        v_alpha = glow * mix(.6, 1.0, z) * u_opacity;
        gl_PointSize = v_alpha < .01 ? 0.0 : u_dpr * mix(9.0, 18.0, z) * u_size;
      }`,
      fs: `${FS_HEAD}
      in float v_alpha;
      void main() {
        float d = length(gl_PointCoord - .5) * 2.0;
        float core = exp(-d*d*38.0);
        float halo = exp(-d*d*5.0) * .75;
        float a = (core + halo) * v_alpha;
        vec3 col = mix(u_colorB, u_colorA, core / (core + halo + 1e-4));
        // Less alpha than color, so the glow adds light like it would at night.
        outColor = vec4(col * a, a * .7);
        if (a < .01) discard;
      }`,
      colors: () => [[1.0, 0.98, 0.72], [0.74, 0.9, 0.32]],
    },
    // Summer days: soft dandelion fluff and pollen drifting on the breeze, the pollen catching the
    // light. A is the seeds' color, B the pollen's. Without fluff, it's motes in the sun.
    seeds: {
      fps: 30,
      density: 70,
      min: 30,
      max: 110,
      vs: `${HEAD}
      out float v_alpha, v_kind;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
        float seed = step(1.0 - u_share, r5);
        float z = mix(.3, 1.0, r3);
        float t = u_time;
        float x = r1*2.0-1.0 + windX(mix(.35, 1.0, z)) + sin(t*mix(.2, .5, r2) + r4*6.28) * .02;
        float y = r2*2.0-1.0 + t * mix(.004, .014, r4) * u_fall + sin(t*mix(.3, .7, r4) + r1*6.28) * .05;
        x = wrapX(x, .15);
        y = -1.15 + mod(y + 1.15, 2.3);
        gl_Position = vec4(x, y, 0.0, 1.0);
        gl_PointSize = max(1.0, u_dpr * (seed > .5 ? mix(8.0, 16.0, z) : mix(2.5, 5.5, z)) * u_size);
        float glint = seed > .5 ? 1.0 : .45 + .55 * pow(.5 + .5*sin(t*mix(1.0, 2.6, r4) + r2*6.28), 3.0);
        v_alpha = mix(.45, .95, z) * glint * u_opacity;
        v_kind = seed;
      }`,
      fs: `${FS_HEAD}
      in float v_alpha, v_kind;
      void main() {
        vec2 q = (gl_PointCoord - .5) * 2.0;
        float r = length(q);
        float a;
        vec3 col;
        if (v_kind > .5) {
          // A soft tuft of fluff around a small, brighter core.
          float fluff = smoothstep(1.0, .2, r) * .7;
          float core = smoothstep(.32, .08, r) * .8;
          a = clamp(fluff + core, 0.0, 1.0) * v_alpha;
          col = u_colorA;
        } else {
          a = smoothstep(1.0, .2, r) * v_alpha;
          col = u_colorB;
        }
        outColor = vec4(col * a, a);
        if (outColor.a < .02) discard;
      }`,
      colors: ({ dark, background }) =>
        dark || background ? [[1.0, 0.99, 0.93], [1.0, 0.93, 0.66]] : [[0.54, 0.5, 0.4], [0.72, 0.58, 0.26]],
    },
    // Rain: thin streaks that come in soft bursts, slanted by the wind against their fall. A is the
    // near streaks' color, B the far ones'.
    rain: {
      fps: 60,
      density: 260,
      min: 90,
      max: 450,
      vs: `${HEAD}
      out float v_alpha, v_depth, v_width;
      out vec2 v_dir;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0);
        float z = mix(.35, 1.0, pow(r3, 1.3));
        float v = mix(1.1, 2.0, z) * u_fall;
        vec2 f = fallPass(r2, u_time * v);
        float y = f.x;
        float depth = mix(.55, 1.0, z);
        float x = wrapX(columnHash(f.y)*2.0-1.0 + pathX(y, v, depth), .15);
        gl_Position = vec4(x, y, 0.0, 1.0);
        // Sideways pixels per pixel of fall, as the wind blows here and now.
        float slant = 2.0 * u_wind * depth * shearAt(y) * gustNow() / v;
        v_dir = normalize(vec2(slant, 1.0));
        // Bursts: the shower's strength rises and falls, and each streak shows above its own level.
        float level = mix(.1, 1.0, smoothstep(.15, .85, .5 + .5*sin(u_time*.23 + sin(u_time*.07)*2.0)));
        float shown = smoothstep(r4 - .1, r4, level);
        float size = u_dpr * mix(14.0, 30.0, z) * u_size;
        gl_PointSize = shown < .01 ? 0.0 : size;
        v_alpha = mix(.25, .6, z) * shown * u_opacity * bandFade(y);
        v_depth = z;
        // Half a streak's width in point coordinates: about 0.6 px.
        v_width = .6 * u_dpr * 2.0 / size;
      }`,
      fs: `${FS_HEAD}
      in float v_alpha, v_depth, v_width;
      in vec2 v_dir;
      void main() {
        vec2 q = (gl_PointCoord - .5) * 2.0;
        float across = abs(dot(q, vec2(-v_dir.y, v_dir.x)));
        float along = dot(q, v_dir);
        float a = (1.0 - smoothstep(v_width, v_width * 2.5, across)) * smoothstep(1.0, .1, abs(along)) * mix(.35, 1.0, along * .5 + .5) * v_alpha;
        vec3 col = mix(u_colorB, u_colorA, v_depth);
        outColor = vec4(col * a, a);
        if (outColor.a < .01) discard;
      }`,
      colors: ({ dark, background }) =>
        dark ? [[0.8, 0.87, 0.96], [0.56, 0.66, 0.8]] : background ? [[0.4, 0.48, 0.6], [0.58, 0.65, 0.75]] : [[0.4, 0.5, 0.63], [0.6, 0.68, 0.78]],
    },
    // Snow or frost glittering in the image's snowy zones (`zones`, so it misses water): specks that
    // shimmer faintly and slowly (`shimmer`, `tempo`), and now and then a glint at full brightness,
    // timed so that about `peaks` show at once, each for `peakTime` seconds and `peakSize` times as
    // large. Specks are larger nearer the viewer. A is the glints' color at their peak, B at their
    // edge.
    glitter: {
      fps: 30,
      density: 500,
      min: 150,
      max: 900,
      vs: `${HEAD}
      uniform float u_shimmer, u_peakTime, u_peakSize;
      // How often each speck glints, in seconds (glitterCycle).
      uniform float u_cycle;
      out float v_alpha;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
        int zi = int(min(floor(r5 * u_zoneCount), u_zoneCount - 1.0));
        vec4 zone = u_zones[zi];
        // Denser toward the zone's top, which is farther away.
        float y = mix(zone.y, zone.w, pow(r2, 1.5));
        gl_Position = vec4(mix(zone.x, zone.z, r1), y, 0.0, 1.0);
        float shimmer = pow(max(0.0, sin(u_time * u_tempo * mix(.25, .8, r3) + r4 * 6.28)), 4.0) * u_shimmer;
        // Each speck's glint comes once a cycle, at its own time.
        float tau = mod(u_time + hash(id*4.71+2.0) * u_cycle, u_cycle);
        float peak = tau < u_peakTime ? pow(sin(3.14159 * tau / u_peakTime), 2.0) : 0.0;
        v_alpha = max(shimmer, peak) * u_opacity * u_zoneGain[zi];
        // 0 at the horizon, 1 at the screen's foot.
        float near = clamp((u_horizon - y) / (u_horizon + 1.0), 0.0, 1.0);
        gl_PointSize = v_alpha < .02 ? 0.0 : max(1.0, u_dpr * u_size * mix(1.0, 2.4, near)) * mix(1.0, u_peakSize, peak);
      }`,
      fs: `${FS_HEAD}
      in float v_alpha;
      void main() {
        float d = length(gl_PointCoord - .5) * 2.0;
        float a = exp(-d * d * 4.0) * (1.0 - smoothstep(.8, 1.0, d)) * v_alpha;
        vec3 col = mix(u_colorB, u_colorA, exp(-d * d * 9.0));
        outColor = vec4(col * a, a);
        if (outColor.a < .01) discard;
      }`,
      colors: ({ dark, background }) => (dark || background ? [[1.0, 1.0, 1.0], [0.9, 0.95, 1.0]] : [[0.36, 0.52, 0.7], [0.55, 0.68, 0.8]]),
    },
    // Summer by the water: small groups of midges, a pixel or two each, idling over the water; a
    // share (`share`) glint by day. `zones` places them: three quarters of the groups in the first,
    // the rest in the second. At night `glow` fireflies wander on their own in the third, along the
    // bank. A is the midges' color, B the glints' and fireflies'.
    insects: {
      fps: 60,
      density: 18,
      min: 9,
      max: 30,
      vs: `${HEAD}
      out float v_alpha, v_kind;
      void main() {
        float id = float(gl_VertexID) + 1.0;
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
        float firefly = step(float(gl_VertexID) + .5, u_glow);
        vec2 p;
        if (firefly > .5) {
          // Wandering slowly along the bank.
          vec4 zone = u_zones[2];
          float t = u_time * u_tempo * mix(.05, .09, r4);
          p = vec2(mix(zone.x, zone.z, r1) + sin(t*2.1 + r4*6.28)*.04, mix(zone.w, zone.y, r2) + sin(t*3.3 + r5*6.28)*.015);
        } else {
          // Groups of three, each idling about a point that drifts slowly with the wind.
          float group = floor((float(gl_VertexID) - u_glow) / 3.0);
          float s1 = hash(group*7.3+1.0), s2 = hash2(group*3.1+2.0);
          vec4 zone = u_zones[hash(group*5.9+4.0) < .75 ? 0 : 1];
          vec2 c = vec2(mix(zone.x, zone.z, s1) + sin(u_time*.03 + s2*6.28)*.05 + windX(1.0), mix(zone.w, zone.y, s2));
          float t = u_time * u_tempo * mix(.4, .7, r4);
          vec2 o = vec2(sin(t*2.3 + r2*6.28) + .5*sin(t*4.1 + r3*6.28), cos(t*1.9 + r3*6.28) + .5*sin(t*3.7 + r2*6.28));
          p = c + o * vec2(.03 * u_res.y / u_res.x, .03) * mix(.6, 1.2, r5);
        }
        p.x = wrapX(p.x, .1);
        gl_Position = vec4(p, 0.0, 1.0);
        float z = mix(.4, 1.0, r3);
        float special = max(firefly, step(1.0 - u_share, hash(id*1.91+5.0)));
        // A firefly's glow: quick on, slower off, then dark for the rest of its cycle.
        float ph = fract(u_time / mix(4.0, 7.0, r5) + r1);
        float glow = smoothstep(0.0, .12, ph) * (1.0 - smoothstep(.18, .6, ph));
        v_kind = special + firefly;
        v_alpha = mix(mix(.5, .9, z) * (.8 + .2*sin(u_time*17.0 + r2*6.28)), glow, firefly) * u_opacity;
        gl_PointSize = v_alpha < .01 ? 0.0 : u_dpr * u_size * mix(max(1.0, mix(1.0, 2.2, z)), mix(9.0, 16.0, z), firefly);
      }`,
      fs: `${FS_HEAD}
      // 0 for a midge, 1 for one that glints, 2 for a firefly.
      in float v_alpha, v_kind;
      void main() {
        float d = length(gl_PointCoord - .5) * 2.0;
        float firefly = step(1.5, v_kind);
        float a = mix(smoothstep(1.1, .2, d), exp(-d*d*38.0) + exp(-d*d*5.0)*.6, firefly) * v_alpha;
        vec3 col = mix(u_colorA, u_colorB, min(v_kind, 1.0));
        outColor = vec4(col * a, a * mix(1.0, .7, firefly));
        if (a < .01) discard;
      }`,
      colors: ({ dark, background }) =>
        dark ? [[0.6, 0.66, 0.76], [1.0, 0.98, 0.72]] : background ? [[0.16, 0.15, 0.12], [1.0, 0.96, 0.82]] : [[0.3, 0.3, 0.28], [0.72, 0.58, 0.26]],
    },
    // Night mist: wide, soft banks of uneven density that drift along a band near the horizon. Each
    // bank is one quad. A is the thick parts' color, B the thin parts'.
    mist: {
      // The banks barely move: at most 0.03 screen heights a second, about 3 px a frame at 10 fps
      // on a 900 px screen, which their soft, 100 px wide edges hide.
      fps: 10,
      // Soft throughout, so half a backing pixel per CSS pixel looks the same (`resolution`, as
      // in the app).
      resolution: 0.5,
      density: 16,
      min: 10,
      max: 24,
      quads: true,
      vs: `${HEAD}
      out vec2 v_uv, v_p;
      out float v_alpha;
      const vec2 CORNERS[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));
      void main() {
        float id = float(gl_VertexID / 6) + 1.0;
        vec2 c = CORNERS[gl_VertexID % 6];
        float r1 = hash(id), r2 = hash2(id), r3 = hash(id*3.17+7.0), r4 = hash2(id*5.73+11.0), r5 = hash(id*9.31+3.0);
        float z = mix(.4, 1.0, r3);
        // With zones, each bank keeps to one: its rows are the band, and it fades out as it drifts
        // past the zone's sides.
        vec4 zone = vec4(-1e3, u_band.x, 1e3, u_band.y);
        float gain = 1.0;
        if (u_zoneCount > .5) {
          int zi = int(min(floor(hash(id*7.73+1.3) * u_zoneCount), u_zoneCount - 1.0));
          zone = u_zones[zi];
          gain = u_zoneGain[zi];
        }
        // Half the bank's width and height in clip space: wide and low, up to half the band tall.
        float band = zone.y - zone.w;
        vec2 half_ = vec2(mix(.35, .75, r4) * u_size, band * mix(.25, .5, r5));
        float cy = mix(zone.w + half_.y * .6, zone.y - half_.y * .6, r2);
        float x = r1*2.0-1.0 + windX(z) + sin(u_time*.03 + r5*6.28) * .03;
        float cx = wrapX(x, half_.x);
        // A gathered bank is no wider than its zone and wraps within it, passing its sides once
        // faded out. Gathered banks thin out together over about 90 seconds, thickest at the
        // start, so the zone clears now and then.
        float breathe = 1.0;
        if (u_zoneCount > .5 && hash(id*13.37+5.1) < u_gather) {
          half_.x = min(half_.x, (zone.z - zone.x) * .5);
          float lo = zone.x - half_.x;
          cx = lo + mod(x - lo, zone.z - zone.x + 2.0*half_.x);
          breathe = smoothstep(.15, .6, .5 + .5 * cos(u_time * .07 + r3 * .6));
        }
        gl_Position = vec4(vec2(cx, cy) + c * half_, 0.0, 1.0);
        v_uv = c;
        // The texture's coordinates, in screen heights, move with the bank.
        v_p = c * half_ * vec2(u_res.x / u_res.y, 1.0) * .5 + r1 * 17.0;
        v_alpha = .22 * u_opacity * mix(.5, 1.0, z) * (.7 + .3 * sin(u_time * mix(.05, .12, r4) + r1 * 6.28));
        v_alpha *= gain * breathe * smoothstep(.35, 0.0, max(zone.x - cx, cx - zone.z));
      }`,
      fs: `${FS_HEAD}
      in vec2 v_uv, v_p;
      in float v_alpha;
      // An integer hash of a lattice cell, exact at any precision; a sin() hash breaks down in
      // mediump.
      float vhash(vec2 cell){
        highp uvec2 q = uvec2(ivec2(cell) + 4096);
        highp uint x = q.x * 1664525u ^ (q.y * 1013904223u + 12345u);
        x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
        return float(x) / 4294967295.0;
      }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0 - 2.0*f);
        return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 u = v_uv;
        // Soft all round, reaching zero at the quad's edge.
        float shape = exp(-(u.x*u.x*1.6 + u.y*u.y*3.0)) * (1.0 - u.x*u.x) * (1.0 - u.y*u.y);
        // Pixels this faint are discarded below anyway; skipping the noise there saves most of the
        // quad's corners.
        if (shape * v_alpha < .004) discard;
        float n = vnoise(v_p * 3.0) * .65 + vnoise(v_p * 7.0 + 4.0) * .35;
        float a = shape * smoothstep(.15, .85, n) * v_alpha;
        vec3 col = mix(u_colorB, u_colorA, n);
        outColor = vec4(col * a, a);
        if (outColor.a < .004) discard;
      }`,
      colors: ({ dark, background }) =>
        dark ? [[0.66, 0.74, 0.84], [0.5, 0.58, 0.7]] : background ? [[1.0, 1.0, 1.0], [0.92, 0.95, 0.98]] : [[0.7, 0.78, 0.86], [0.8, 0.86, 0.92]],
    },
    // Night sky: stars at fixed points of the image's open sky (`sky`, out of the `moon`'s circle),
    // each scintillating a little all the time and now and then flashing brighter, about `peaks` at
    // once for `peakTime` seconds, `peakSize` times as large. `count` and `seed` pick them
    // (placeStars), and the pace doesn't thin them (`layout`); `spread` sets bright against faint,
    // `tempo` the twinkle's speed. A is a cool star's color, B a warm one's.
    stars: {
      fps: 30,
      layout: starLayout,
      vs: `${HEAD}${HASH}
      uniform vec4 u_cover, u_stars[32];
      uniform float u_spread, u_cycle, u_peakTime, u_peakSize;
      uniform vec3 u_colorA, u_colorB;
      flat out vec4 v_color;
      float rnd(uint item, uint k){ return float(lowbias32(lowbias32(item) + k) >> 8) / 16777216.0; }
      void main() {
        uint item = uint(gl_VertexID);
        vec4 two = u_stars[gl_VertexID / 2];
        vec2 at = gl_VertexID % 2 == 0 ? two.xy : two.zw;
        gl_Position = vec4(u_cover.zw + at * u_cover.xy, 0.0, 1.0);
        float r1 = rnd(item, 1u), r2 = rnd(item, 2u), r3 = rnd(item, 3u), r4 = rnd(item, 4u);
        // A few bright stars and more faint ones.
        float base = mix(1.0, mix(.25, 1.0, r1*r1), u_spread);
        // Scintillation: three detuned waves per star, so it never repeats visibly.
        float t = u_time * u_tempo * .3;
        float n = sin(t * mix(5.0, 9.0, r2) + r3 * 40.0) * .5
                + sin(t * mix(11.0, 17.0, r3) + r4 * 40.0) * .3
                + sin(t * mix(2.0, 3.5, r4) + r1 * 40.0) * .4;
        float scint = clamp(1.0 + .32 * n, 0.0, 2.0);
        // A quick rise and a slower fade, once a cycle at the star's own time.
        float x = mod(u_time + r4 * u_cycle * 7.13, u_cycle) / u_peakTime;
        float flash = x < 1.0 ? min(smoothstep(0.0, .15, x) * (1.0-x)*(1.0-x) / .72, 1.0) : 0.0;
        float alpha = base * scint * mix(1.0, 2.2, flash) * u_opacity;
        // Bluish white to warm white, with a slight color flicker as the atmosphere bends it.
        float warm = clamp(r2 * .4 + .075 * sin(t * mix(7.0, 12.0, r1) + r2 * 30.0), 0.0, 1.0);
        v_color = vec4(mix(u_colorA, u_colorB, warm), alpha);
        // The core, and the halo reaching 3.4 times as far.
        float core = .9 * u_size * u_dpr * mix(.7, 1.3, base) * mix(1.0, u_peakSize, flash);
        gl_PointSize = alpha < .005 ? 0.0 : 6.8 * core;
      }`,
      fs: `${FS_HEAD}
      flat in vec4 v_color;
      void main() {
        // 0 at the center, 1 at the point's edge; the core's radius is 0.18 of that.
        float d = length(gl_PointCoord - .5) * 2.0;
        float core = exp(-d*d * 32.1);
        float a = min(1.0, (core + .07 * exp(-d * 2.27)) * v_color.a) * (1.0 - smoothstep(.85, 1.0, d));
        // White in the middle, the star's color around it.
        outColor = vec4(mix(v_color.rgb, vec3(1.0), core * .6) * a, a);
      }`,
      colors: () => [[0.82, 0.9, 1.0], [1.0, 0.9, 0.76]],
    },
    // An aurora's curtains (`curtains`), each standing on its lower edge, a Catmull-Rom curve
    // through its points, drawn as quads along it. Its rays are value noise along the curtain that
    // drifts sideways, upright but ending at their own heights; the edge sways slowly, brightness
    // pulses travel along it, and dim patches drift along it. Where a curtain bends toward the
    // viewer, its rays line up behind each other and it glows brighter.
    // The treeline (0.72 of the image's height, land December's) hides it. A is the green, B the
    // violet of its top.
    aurora: {
      fps: 30,
      quads: true,
      layout: auroraLayout,
      vs: `${HEAD}${HASH}${VNOISE}
      // Per control point: x, y, and the distance along its curtain in image widths. Per curtain:
      // its first and last control points, height, and gain; then its lean, seed, length, and
      // first quad.
      uniform vec4 u_cover, u_base[24], u_curtain[4], u_curtainB[4];
      out float v_u, v_v, v_y, v_gain, v_pulse, v_x, v_ray1, v_ray2, v_top;
      const vec2 CORNERS[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 0), vec2(1, 1), vec2(0, 1));
      void main() {
        int quad = gl_VertexID / 6;
        vec2 corner = CORNERS[gl_VertexID % 6];
        float q = float(quad);
        int c = int(step(u_curtainB[1].w, q) + step(u_curtainB[2].w, q) + step(u_curtainB[3].w, q));
        vec4 cur = u_curtain[c], curB = u_curtainB[c];
        int local = quad - int(curB.w), first = int(cur.x), last = int(cur.y);
        int k = first + local / ${AURORA_STEPS};
        float t = (float(local % ${AURORA_STEPS}) + corner.x) / ${AURORA_STEPS}.0;
        vec4 b1 = u_base[k], b2 = u_base[min(k + 1, last)];
        vec2 p0 = u_base[max(k - 1, first)].xy, p1 = b1.xy, p2 = b2.xy, p3 = u_base[min(k + 2, last)].xy;
        vec2 a = 2.0*p0 - 5.0*p1 + 4.0*p2 - p3, b = 3.0*p1 - p0 - 3.0*p2 + p3;
        vec2 p = .5 * (2.0*p1 + (p2 - p0)*t + a*t*t + b*t*t*t);
        vec2 dp = .5 * ((p2 - p0) + 2.0*a*t + 3.0*b*t*t);
        float steep = abs(dp.y) / max(length(vec2(dp.x * ${PHOTO_ASPECT.toFixed(4)}, dp.y)), 1e-6);
        float s = mix(b1.z, b2.z, t), v = corner.y, seed = curB.y;
        float time = u_time * u_tempo, sway = time * .4, x0 = p.x;
        p.y += sin(s*9.0 + sway*.7 + seed) * .006 + sin(s*23.0 - sway*1.1 + seed*2.0) * .0025;
        p.x += sin(s*5.0 - sway*.5 + seed) * .004;
        // Taller and shorter along the curtain, slowly changing.
        float h = cur.z * 1.4 * (.75 + .25 * sin(s*7.0 + sway*.4 + seed*3.0));
        p -= v * h * vec2(curB.x / ${PHOTO_ASPECT.toFixed(4)}, 1.0);
        // Rays in perspective: each tilts very slightly toward one point far above x 0.15, the
        // middle of land December's curtains.
        p.x += v * h * (.15 - x0) * .3;
        gl_Position = vec4(u_cover.zw + p * u_cover.xy, 0.0, 1.0);
        v_x = s * 150.0;
        v_ray1 = time * .24 + seed * 13.0;
        v_ray2 = seed * 7.0 - time * .4;
        v_top = time * .24 + seed * 11.0;
        v_pulse = mod(seed * 5.0 - time * .5, 6.2832);
        v_u = s / curB.z;
        v_v = v;
        v_y = p.y;
        // Stretches of the curtain dim as patches drift along it, slowly enough to work out per
        // corner.
        float patches = vnoise(s * 20.0 + seed * 17.0 + time * .05) * .7 + vnoise(s * 51.67 + seed * 3.0 - time * .08) * .3;
        v_gain = cur.w * (1.0 + 2.5 * steep) * u_opacity * (.235 + .765 * smoothstep(.25, .75, patches));
      }`,
      fs: `${FS_HEAD}${HASH}${VNOISE}
      in float v_u, v_v, v_y, v_gain, v_pulse, v_x, v_ray1, v_ray2, v_top;
      void main() {
        float rays = vnoise(v_x + v_ray1) * .6 + vnoise(v_x * 2.7 + v_ray2) * .4;
        rays = mix(1.0, pow(rays, 1.6) * 1.9, .6);
        // Each ray ends at its own height.
        float top = mix(.4, 1.05, vnoise(v_x * .9 + v_top));
        float ragged = mix(1.0, smoothstep(top, top - .3, v_v), .5);
        // Brightest just above the lower edge, fading upward, and out at the curtain's ends.
        float profile = smoothstep(0.0, .22, v_v) * exp(-2.6 * v_v) * (1.0 - v_v);
        float ends = smoothstep(0.0, .15, v_u) * smoothstep(1.0, .8, v_u);
        float pulse = 1.0 - .45 * (.5 + .5 * sin(v_u * 9.0 + v_pulse));
        float trees = smoothstep(.73, .72, v_y);
        float a = clamp(profile * ragged * ends * rays * pulse * v_gain * trees * .5, 0.0, 1.0);
        vec3 col = mix(u_colorA, u_colorB, smoothstep(.35, 1.0, v_v) * .2);
        outColor = vec4(col * a, a);
      }`,
      colors: () => [[0.36, 1.0, 0.62], [0.72, 0.42, 1.0]],
    },
  }
  // Uniform defaults for a preset's missing fields.
  const TUNING = { wind: 0, gust: 0, shear: 0, amount: 1, size: 1, fall: 1, opacity: 1, share: 0.3, glow: 0, tempo: 1, gather: 0, shimmer: 0.3, peaks: 1.2, peakTime: 1.5, peakSize: 2, count: 60, seed: 91, spread: 0.6 }
  // A rectangle of the image, [left, top, right, bottom] as fractions of its width and height, in
  // clip space. `cover` centers the photo across.
  function zoneClip([left, top, right, bottom], w, h) {
    const shown = Math.max(w, h * PHOTO_ASPECT)
    const x = (f) => (2 * ((w - shown) / 2 + f * shown)) / w - 1
    const [t, b] = bandClip([top, bottom], w, h)
    return [x(left), t, x(right), b]
  }
  function bandClip(band, w, h) {
    if (!band) return FULL_BAND
    const shown = Math.max(h, w / PHOTO_ASPECT)
    const top = (h - shown) * PHOTO_Y
    return band.map((f) => 1 - (2 * (top + f * shown)) / h)
  }
  // Where `cover` puts the image in clip space: x = z + f.x * x, y = w + f.y * y for a point f of
  // the image, as zoneClip maps it.
  function coverClip(w, h) {
    const shownW = Math.max(w, h * PHOTO_ASPECT)
    const shownH = Math.max(h, w / PHOTO_ASPECT)
    const top = (h - shownH) * PHOTO_Y
    return [(2 * shownW) / w, (-2 * shownH) / h, (w - shownW) / w - 1, 1 - (2 * top) / h]
  }

  // How often each glitter speck glints, in seconds, so that about `peaks` glints show at once on a
  // 1440 x 900 screen, proportionally more on a larger one. It leaves out the screen's size, so a
  // resize doesn't move every speck to another point of its cycle.
  function glitterCycle(t) {
    return (EFFECTS.glitter.density * t.amount * t.peakTime) / Math.max(t.peaks, 0.01)
  }
  // How often each star flashes, in seconds, so that about `peaks` flash at once.
  function starCycle(t, count) {
    return Math.max(t.peakTime, (count * t.peakTime) / Math.max(t.peaks, 0.01))
  }

  // stars.html's generator, so a seed places the stars where Kait picked them.
  function rng(seed) {
    let s = seed * 2654435761
    return () => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function inPolygon(polygon, [x, y]) {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]
      const [xj, yj] = polygon[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  // Up to `count` stars in the sky's polygons, out of the moon's circle, kept apart so they don't
  // clump, as stars.html places them.
  function placeStars({ sky = [], moon, count, seed }) {
    const random = rng(seed)
    const stars = []
    const top = Math.max(0, ...sky.flat().map((p) => p[1]))
    const gap = 0.35 / Math.sqrt(count)
    for (let tries = 0; stars.length < count && tries < 5000; tries++) {
      const p = [random(), random() * top]
      if (moon && Math.hypot((p[0] - moon[0]) * PHOTO_ASPECT, p[1] - moon[1]) < moon[2]) continue
      if (!sky.some((polygon) => inPolygon(polygon, p))) continue
      const near = gap * (tries < 3000 ? 1 : 0.4)
      if (stars.some((s) => Math.hypot((s[0] - p[0]) * 1.77, s[1] - p[1]) < near)) continue
      stars.push(p)
      // stars.html draws four more numbers per star; the shader hashes its own instead.
      for (let k = 0; k < 4; k++) random()
    }
    return stars
  }
  const MAX_STARS = 64
  // An effect's `layout` gives its item count, which the pace doesn't thin, and vec4 uniform arrays
  // worked out on a start or a resize.
  function starLayout(t, w, h) {
    const packed = placeStars({ ...t, count: Math.min(t.count, MAX_STARS) }).flat()
    return { count: packed.length / 2, uniforms: { u_cover: coverClip(w, h), u_stars: [...packed, ...Array(MAX_STARS * 2 - packed.length).fill(0)] } }
  }
  // A curtain's points along its Catmull-Rom curve, `steps` per stretch, the ends repeated.
  function catmullRom(points, steps) {
    const p = [points[0], ...points, points.at(-1)]
    const out = []
    for (let i = 1; i < p.length - 2; i++) {
      for (let j = 0; j < steps; j++) {
        const t = j / steps
        out.push([0, 1].map((k) => 0.5 * (2 * p[i][k] + (p[i + 1][k] - p[i - 1][k]) * t + (2 * p[i - 1][k] - 5 * p[i][k] + 4 * p[i + 1][k] - p[i + 2][k]) * t * t + (3 * p[i][k] - p[i - 1][k] - 3 * p[i + 1][k] + p[i + 2][k]) * t * t * t)))
      }
    }
    out.push(points.at(-1))
    return out
  }
  const MAX_CURTAIN_POINTS = 24
  function auroraLayout(t, w, h) {
    const base = []
    const curtain = []
    const curtainB = []
    let quads = 0
    for (const [c, { base: points, height, gain, lean = 0 }] of (t.curtains ?? []).slice(0, 4).entries()) {
      const first = base.length / 4
      if (first + points.length > MAX_CURTAIN_POINTS) break
      // The distance along the curve to each point, in image widths.
      const curve = catmullRom(points, AURORA_STEPS)
      let length = 0
      for (const [i, [x, y]] of points.entries()) {
        for (let j = (i - 1) * AURORA_STEPS + 1; i && j <= i * AURORA_STEPS; j++) length += Math.hypot(curve[j][0] - curve[j - 1][0], (curve[j][1] - curve[j - 1][1]) / PHOTO_ASPECT)
        base.push(x, y, length, 0)
      }
      curtain.push(first, first + points.length - 1, height, gain)
      curtainB.push(lean, c * 1.7 + 0.3, length, quads)
      quads += (points.length - 1) * AURORA_STEPS
    }
    while (curtainB.length < 16) {
      curtain.push(0, 0, 0, 0)
      curtainB.push(0, 1, 1, 1e9)
    }
    return { count: quads, uniforms: { u_cover: coverClip(w, h), u_base: [...base, ...Array(MAX_CURTAIN_POINTS * 4 - base.length).fill(0)], u_curtain: curtain, u_curtainB: curtainB } }
  }

  function resolution(weather) {
    return EFFECTS[weather.effect].resolution ?? 1.5
  }
  // A resolved weather's effects, as canvases from the lowest up, each with the effects it draws.
  // As in the app, effects at the same resolution share a canvas and draw at the faster one's
  // rate; one at a coarser resolution, as the mist is, gets a canvas of its own, so it keeps its own
  // rate and density (task 076, subtask 01).
  function weatherCanvases(weather) {
    const canvases = []
    for (const effect of [weather, weather.also].filter((w) => w?.effect)) {
      const shared = canvases.at(-1)
      if (shared && resolution(shared[0]) === resolution(effect)) shared.push(effect)
      else canvases.push([effect])
    }
    return canvases
  }

  // One WebGL context per canvas; each effect's program compiles the first time it runs.
  // `pace()` returns factors for the point count and the speed, so app pages can run a calmer version.
  function renderer(canvas, pace) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return null
    const compile = (type, src) => {
      const sh = gl.createShader(type)
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
      return sh
    }
    const UNIFORMS = ['u_res', 'u_band', 'u_horizon', 'u_time', 'u_dpr', 'u_wind', 'u_gust', 'u_shear', 'u_size', 'u_fall', 'u_opacity', 'u_share', 'u_glow', 'u_tempo', 'u_gather', 'u_zones', 'u_zoneCount', 'u_zoneGain', 'u_cycle', 'u_shimmer', 'u_peakTime', 'u_peakSize', 'u_spread', 'u_colorA', 'u_colorB']
    const programs = {}
    function program(name) {
      if (programs[name]) return programs[name]
      const fx = EFFECTS[name]
      const p = gl.createProgram()
      gl.attachShader(p, compile(gl.VERTEX_SHADER, fx.vs))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fx.fs))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)]))
      return (programs[name] = { p, u })
    }
    gl.bindVertexArray(gl.createVertexArray())
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    // The canvas's size in CSS pixels, kept by an observer so frames don't force a layout.
    let cssWidth = canvas.clientWidth
    let cssHeight = canvas.clientHeight
    new ResizeObserver(([entry]) => {
      cssWidth = entry.contentRect.width
      cssHeight = entry.contentRect.height
      for (const layer of layers) layer.setup = null
    }).observe(canvas)

    let raf = 0
    let last = 0
    let elapsed = 0
    // The effects drawn, the first lowest: each `{ weather, colors, setup }`, where `setup` is what
    // a frame draws it with, worked out again only on a start or a resize.
    let layers = []
    function prepare(weather, w, h) {
      const t = { ...TUNING, ...weather }
      const fx = EFFECTS[weather.effect]
      const zones = (t.zones ?? [[0, t.horizon ?? 1, 1, 1]]).slice(0, 4).map((zone) => zoneClip(zone.slice(0, 4), w, h))
      // Item counts scale with the drawn area. A band's effect keeps the count of its full-screen
      // version, so it's thicker in the band.
      const area = (cssWidth * cssHeight) / (1440 * 900)
      const layout = fx.layout?.(t, w, h)
      const count = layout ? layout.count : Math.round(Math.min(fx.max, Math.max(fx.min, fx.density * area)) * t.amount * pace().density)
      return {
        w,
        h,
        t,
        fx,
        band: bandClip(t.band, w, h),
        horizon: t.horizon == null ? FULL_BAND[1] : bandClip([t.horizon, 1], w, h)[0],
        zones: [...zones.flat(), ...Array((4 - zones.length) * 4).fill(0)],
        zoneCount: zones.length,
        zoneGain: [0, 1, 2, 3].map((i) => t.zones?.[i]?.[4] ?? 1),
        count,
        cycle: weather.effect === 'stars' ? starCycle(t, count) : glitterCycle(t),
        uniforms: layout?.uniforms ?? {},
      }
    }

    // As in the app (src/lib/scene/weather.ts), the weather draws every nth display refresh, so its
    // frames are evenly spaced; the rate is the low quartile of the first gaps after a start. The
    // app also steps down a refresh when frames drop; the prototype doesn't.
    const MEASURED_GAPS = 10
    let gaps = []
    let hz = 0
    let prev = 0
    function frame(now) {
      raf = requestAnimationFrame(frame)
      const gap = prev ? now - prev : 0
      prev = now
      if (gap && !hz) {
        gaps.push(gap)
        if (gaps.length === MEASURED_GAPS) hz = Math.round(1000 / gaps.sort((a, b) => a - b)[MEASURED_GAPS >> 2])
      }
      // The fastest layer's rate, at the finest one's resolution.
      const fps = Math.max(...layers.map(({ weather }) => weather.fps ?? EFFECTS[weather.effect].fps))
      const due = hz ? Math.round(((now - last) * hz) / 1000) >= Math.max(1, Math.round(hz / fps)) : now - last >= (1000 / fps) * 0.8
      if (!due) return
      elapsed += (Math.min(now - (last || now), 100) / 1000) * pace().speed
      last = now
      const dpr = Math.min(devicePixelRatio || 1, Math.max(...layers.map(({ weather }) => resolution(weather))))
      const w = Math.max(1, Math.floor(cssWidth * dpr))
      const h = Math.max(1, Math.floor(cssHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (const layer of layers) {
        const { p, u } = program(layer.weather.effect)
        gl.useProgram(p)
        // Uniforms that change only with the setup go up once; each layer's program keeps them.
        if (!layer.setup || layer.setup.w !== w || layer.setup.h !== h || layer.setup.dpr !== dpr) {
          const setup = (layer.setup = prepare(layer.weather, w, h))
          setup.dpr = dpr
          const { t } = setup
          gl.uniform2f(u.u_res, w, h)
          gl.uniform2f(u.u_band, ...setup.band)
          gl.uniform1f(u.u_horizon, setup.horizon)
          gl.uniform4fv(u.u_zones, setup.zones)
          gl.uniform1f(u.u_zoneCount, setup.zoneCount)
          gl.uniform4fv(u.u_zoneGain, setup.zoneGain)
          gl.uniform1f(u.u_dpr, dpr)
          for (const key of ['wind', 'gust', 'shear', 'size', 'fall', 'opacity', 'share', 'glow', 'tempo', 'gather', 'shimmer', 'peakTime', 'peakSize', 'spread']) gl.uniform1f(u[`u_${key}`], t[key])
          gl.uniform1f(u.u_cycle, setup.cycle)
          for (const [name, values] of Object.entries(setup.uniforms)) gl.uniform4fv(gl.getUniformLocation(p, name), values)
        }
        const { fx, count } = layer.setup
        gl.uniform1f(u.u_time, elapsed)
        gl.uniform3f(u.u_colorA, ...layer.colors[0])
        gl.uniform3f(u.u_colorB, ...layer.colors[1])
        if (fx.quads) gl.drawArrays(gl.TRIANGLES, 0, count * 6)
        else gl.drawArrays(gl.POINTS, 0, count)
      }
    }
    return {
      // `shown` is the effects to draw, the first lowest: each `{ weather, colors }`, a resolved
      // weather with an effect (weatherFor) and its two colors for the page's theme. Throws if an
      // effect's shaders don't compile.
      start(shown) {
        for (const { weather } of shown) program(weather.effect)
        layers = shown.map((layer) => ({ ...layer, setup: null }))
        if (raf) return
        last = 0
        prev = 0
        hz = 0
        gaps = []
        raf = requestAnimationFrame(frame)
      },
      stop() {
        cancelAnimationFrame(raf)
        raf = 0
        layers = []
        gl.clear(gl.COLOR_BUFFER_BIT)
      },
    }
  }

  // --- Photos ----------------------------------------------------------------------------------
  // Each image comes 1920 and 3840 px wide, and 400 for pickers (design/backgrounds/README.md).
  // `cover` stretches it to the larger of the viewport's width and its height's 16:9 width, so that
  // is what the file has to cover. Screens under 768 px get the small file whatever their pixel ratio.
  const PHOTO_SMALL = 1920
  const PHOTO_LARGE = 3840
  function photoWidth() {
    if (innerWidth < 768) return PHOTO_SMALL
    const needed = Math.max(innerWidth, (innerHeight * 16) / 9) * Math.min(devicePixelRatio || 1, 2)
    return needed > PHOTO_SMALL * 1.25 ? PHOTO_LARGE : PHOTO_SMALL
  }
  // Files loaded and decoded, so a layer only switches to an image that's ready to paint.
  const ready = new Set()
  const loading = new Map()
  function load(url) {
    if (!loading.has(url)) {
      const img = new Image()
      img.src = url
      loading.set(
        url,
        img.decode().then(
          () => ready.add(url),
          () => {},
        ),
      )
    }
    return loading.get(url)
  }

  // --- Controller ------------------------------------------------------------------------------
  // `image` is an image id; a season id is also one, so auth.html's `season` still works.
  // `pace` is `{ density, speed }`, each a factor of the sign-in page's weather. `skip` lists effects
  // the scene leaves out of an image's weather, for stars.html, which draws its own stars and aurora.
  function create({ season = 'winter', image: imageId = season, strength = 'full', background = true, weather = true, seasonWeather = false, pace = { density: 1, speed: 1 }, legacy = false, tuning = null, skip = [] } = {}) {
    const el = document.createElement('div')
    el.className = 'scene'
    el.setAttribute('aria-hidden', 'true')
    // Two canvases, the lower for an image's first effect when its second draws at another
    // resolution (weatherCanvases).
    el.innerHTML = `<div class="scene-photo scene-photo-light"></div><div class="scene-photo scene-photo-dark"></div>
      <div class="scene-tint"></div><div class="scene-vignette"></div><canvas></canvas><canvas></canvas>`
    // `tuning`, for weather.html's sliders: fields by image id and theme that override the table's.
    // `seasonWeather` shows the image's season's weather in place of its own, as a page without the
    // background does: an image's weather fits only its picture.
    const state = { image: imageId, strength, background, weather, seasonWeather, pace, legacy, tuning }
    const canvases = [...el.querySelectorAll('canvas')]
    // The second canvas's context starts the first time an image needs it.
    const renderers = [renderer(canvases[0], () => state.pace)]
    const fx = renderers[0]
    const failed = new Set()
    // `legacy` shows the weather from before task 066, for weather.html.
    function shownWeather() {
      const theme = isDark() ? 'dark' : 'light'
      const id = state.seasonWeather ? image(state.image).season : state.image
      return weatherFor(id, theme, { legacy: state.legacy, overrides: state.legacy ? null : state.tuning?.[id]?.[theme] })
    }
    // The shown weather's effects, the first lowest, less the skipped ones.
    function shownEffects() {
      const weather = shownWeather()
      return [weather, weather.also].filter((w) => w?.effect && !skip.includes(w.effect))
    }
    function colors(weather) {
      return (weather.colors ?? EFFECTS[weather.effect].colors)({ dark: isDark(), background: state.background })
    }

    // Themes whose sharp file loads even while the background is off: the intro's, which opens
    // without it and fades it in later (`preload`).
    const preloaded = new Set()
    // The theme on screen gets the file for this screen, and until that has loaded, the small one,
    // which it then replaces. The other theme gets the small one for the crossfade once the shown
    // theme's file has loaded. Nothing loads while the background is off. It runs after the calling
    // script, so a page that creates the scene and then turns the background off for its intro
    // loads only what the intro needs.
    let queued = false
    function photos() {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        updatePhotos()
      })
    }
    function updatePhotos() {
      const shown = isDark() ? 'dark' : 'light'
      const shownReady = ready.has(photoUrl(state.image, shown, photoWidth()))
      for (const theme of ['light', 'dark']) {
        const layer = el.querySelector(`.scene-photo-${theme}`)
        function show(url) {
          if (layer.dataset.src !== url) layer.style.backgroundImage = `url("${url}")`
          layer.dataset.src = url
          layer.dataset.image = state.image
        }
        const sharp = photoUrl(state.image, theme, photoWidth())
        if (ready.has(sharp)) {
          show(sharp)
          continue
        }
        // Once per file: a file that fails stays on the small one.
        const wanted = (state.background && theme === shown) || preloaded.has(theme)
        if (wanted && !loading.has(sharp)) load(sharp).then(photos)
        const due = theme === shown || shownReady
        if (state.background && due && layer.dataset.image !== state.image) show(photoUrl(state.image, theme, PHOTO_SMALL))
      }
    }
    addEventListener('resize', photos)

    function render() {
      const dark = isDark()
      photos()
      el.style.setProperty('--scene-tint', STRENGTHS[state.strength][dark ? 'dark' : 'light'])
      el.dataset.background = state.background ? 'on' : 'off'
      const on = state.weather && !!fx && !reducedMotion.matches && !document.hidden
      const effects = shownEffects().filter((w) => !failed.has(w.effect))
      // How many canvases run.
      let running = 0
      for (const group of on ? weatherCanvases({ ...effects[0], also: effects[1] }) : []) {
        const drawn = (renderers[running] ??= renderer(canvases[running], () => state.pace))
        if (!drawn) break
        try {
          drawn.start(group.map((weather) => ({ weather, colors: colors(weather) })))
          running++
        } catch (error) {
          console.warn(`Weather effect ${group.map((w) => w.effect).join(', ')} unavailable:`, error)
          drawn.stop()
          for (const w of group) failed.add(w.effect)
        }
      }
      for (const r of renderers.slice(running)) r?.stop()
      canvases.forEach((canvas, i) => canvas.toggleAttribute('data-on', i < running))
      el.dataset.weather = running ? 'on' : 'off'
    }
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    document.addEventListener('visibilitychange', render)
    reducedMotion.addEventListener('change', render)
    render()

    return {
      el,
      set({ season: seasonId, ...patch }) {
        Object.assign(state, seasonId ? { image: seasonId } : {}, patch)
        render()
      },
      get: () => ({ ...state }),
      // Starts loading the theme's sharp image while the background is still off, so it's ready
      // when it fades in.
      preload(theme) {
        preloaded.add(theme)
        photos()
      },
      // Why the weather can't show right now, or null.
      weatherBlocked() {
        if (reducedMotion.matches) return 'Off while your device reduces motion.'
        if (!fx) return 'Your browser has no WebGL 2.'
        if (shownEffects().some((w) => failed.has(w.effect))) return "This image's weather didn't start in your browser."
        return null
      },
    }
  }

  window.scene = {
    create,
    settings,
    SEASONS,
    COLLECTIONS,
    EFFECTS,
    PRESETS,
    TUNING,
    HORIZONS,
    IMAGE_WEATHER,
    LEGACY_WEATHER,
    weatherFor,
    hintFor,
    STRENGTHS,
    DEFAULTS,
    reducedMotion,
    image,
    collectionSetting,
    collectionPatch,
    calendarImage,
    imageFor,
    weatherHint,
    thumbUrl,
  }
})()
