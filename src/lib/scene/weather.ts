// The seasonal scene's weather (prototypes/scene.js, prototypes/README.md, "Weather by image"):
// each image's preset, tuned for the picture (IMAGE_WEATHER), and the Weather hints. The
// renderer that draws it is in weather-renderer.ts, which loads only when the weather runs.
import { createSignal } from 'solid-js'
import type { ImageId } from './images'

export type Effect =
  | 'snow'
  | 'rain'
  | 'seeds'
  | 'fireflies'
  | 'leaves'
  | 'glitter'
  | 'insects'
  | 'mist'
  | 'stars'
  | 'aurora'

export type Rgb = [number, number, number]

// The two colors, A and B, an effect mixes: on dark pages, on light pages over the image, and on
// the plain light page.
export type Colors = Record<'dark' | 'image' | 'plain', [Rgb, Rgb]>

// Factors of the sign-in page's point count and speed. App pages run calm, since the full
// weather felt busy behind real work.
export const PACES = {
  full: { density: 1, speed: 1 },
  calm: { density: 0.5, speed: 0.7 },
} as const

export type Pace = keyof typeof PACES

// A rectangle of the image, [left, top, right, bottom] as fractions of its width and height, and
// optionally a factor of glitter's or mist's opacity there.
export type Zone = [number, number, number, number] | [number, number, number, number, number]

// A point of the image, [x, y] as fractions of its width and height.
export type Point = [number, number]

// An aurora's curtain: its lower edge through `base`, its height in image heights, its brightness,
// and how far its rays lean left per unit up.
type Curtain = { base: Point[]; height: number; gain: number; lean?: number }

// An image's tuning of its preset, all optional:
// - `wind`: the sideways speed of the nearest items, in screen heights per second, positive to the
//   right. Farther items move slower. Everything in the air moves with it, so seeds fly sideways
//   in a wind that barely slants the rain.
// - `gust` (0 to 1): how far the wind rises and falls around that speed.
// - `shear`: how much stronger the wind gets below the horizon, as it picks up near the ground: at
//   the screen's foot it's 1 + shear times the wind, so falling snow arcs toward the side.
// - `amount`, `size`, `fall`, `opacity`: factors of the effect's item count, item size, falling
//   speed, and opacity.
// - `band`: [top, bottom], the rows falling snow and rain keep to, as fractions of the image's
//   height, so spray stays over the sea however the photo is cropped. Without a band they fill
//   the screen.
// - `share`: the share of special items: fluff among seeds, glints among midges. `glow`: how many
//   fireflies fly apart from the midges.
// - `zones`: up to four rectangles of the image: where glitter lies, so it misses water (without
//   them, the ground below the horizon), where midges and fireflies keep, or where mist lies (the
//   same default): each bank keeps to one zone.
// - `tempo`: a factor of the effect's own motion: glitter's shimmer, the midges' flight, the
//   fireflies' flight and glow, the stars' twinkle, the aurora's sway and drift.
// - `gather` (0 to 1): the share of mist banks that stay in their zone, drifting through it and
//   coming back in at its far side. They're thickest at the start and clear now and then. The
//   rest drift across the whole screen and fade in and out at the zone's sides.
// - `shimmer`, `peaks`, `peakTime`, `peakSize`: glitter's faint shimmer, and how many full glints
//   show at once on a 1440 × 900 screen, for how many seconds, and how much larger.
// - `colors`: in place of the effect's colors, on the pages it names.
// - `count`, `seed`, `sky`, `moon`, `spread`: the stars, how many and the seed that places them,
//   in the polygons of open sky and out of the moon's circle ([x, y, radius in image heights]),
//   and how much brighter the bright ones are than the faint (0 all the same). `peaks`,
//   `peakTime`, and `peakSize` are their flashes, as glitter's glints.
// - `curtains`: the aurora's.
type Tuning = {
  wind?: number
  gust?: number
  shear?: number
  amount?: number
  size?: number
  fall?: number
  opacity?: number
  band?: [number, number]
  share?: number
  glow?: number
  zones?: Zone[]
  tempo?: number
  gather?: number
  shimmer?: number
  peaks?: number
  peakTime?: number
  peakSize?: number
  colors?: Partial<Colors>
  count?: number
  seed?: number
  spread?: number
  sky?: Point[][]
  moon?: [number, number, number]
  curtains?: Curtain[]
}

// The Weather hint's name for a preset: `scene_effect_<hint>` in messages/.
export type Hint =
  | 'snow'
  | 'flurries'
  | 'blowing'
  | 'spray'
  | 'rain'
  | 'squall'
  | 'seeds'
  | 'motes'
  | 'dust'
  | 'fireflies'
  | 'midges'
  | 'midges_night'
  | 'leaves'
  | 'glitter'
  | 'frost'
  | 'mist'
  | 'stars'
  | 'aurora'
  | 'none'

// `effect: null` is no weather. `fps` is the preset's frame-rate target, by default its effect's.
type Preset = Tuning & { effect: Effect | null; hint: Hint; fps?: number }

// Uniform values for the fields a preset and its image leave out.
export const PRESETS = {
  snow: { effect: 'snow', hint: 'snow' },
  flurries: { effect: 'snow', hint: 'flurries' },
  // Fine grains, falling fast, in gusts, blown flatter near the ground.
  blowing: {
    effect: 'snow',
    hint: 'blowing',
    fps: 60,
    amount: 2.2,
    size: 0.9,
    fall: 6,
    gust: 0.6,
    shear: 2.5,
  },
  // Droplets torn off the waves: a pixel or two, flying nearly flat.
  spray: {
    effect: 'snow',
    hint: 'spray',
    fps: 60,
    amount: 0.8,
    size: 0.4,
    fall: 2.5,
    gust: 0.9,
    shear: 1.5,
  },
  rain: { effect: 'rain', hint: 'rain' },
  squall: { effect: 'rain', hint: 'squall', size: 1.35, fall: 1.25, gust: 0.8 },
  seeds: { effect: 'seeds', hint: 'seeds' },
  // A few pixels across, for the open coast, where big tufts looked too near.
  'seeds-fine': { effect: 'seeds', hint: 'seeds', size: 0.4 },
  motes: { effect: 'seeds', hint: 'motes', share: 0, size: 0.75, amount: 1.4, opacity: 0.8 },
  // Dust of a pixel, for a sunny day with nothing else in the air.
  'motes-fine': { effect: 'seeds', hint: 'dust', share: 0, size: 0.3, amount: 1.2, opacity: 0.85 },
  // Near-white, since sunlit dust is brighter than the hay behind it.
  dust: {
    effect: 'seeds',
    hint: 'dust',
    share: 0,
    size: 1.1,
    amount: 4,
    opacity: 1,
    gust: 0.4,
    colors: {
      dark: [
        [1.0, 1.0, 0.97],
        [1.0, 0.99, 0.93],
      ],
      image: [
        [1.0, 1.0, 0.97],
        [1.0, 0.99, 0.93],
      ],
    },
  },
  fireflies: { effect: 'fireflies', hint: 'fireflies' },
  midges: { effect: 'insects', hint: 'midges', share: 0.25 },
  'midges-night': { effect: 'insects', hint: 'midges_night', share: 0, glow: 2 },
  leaves: { effect: 'leaves', hint: 'leaves' },
  glitter: { effect: 'glitter', hint: 'glitter' },
  'glitter-night': {
    effect: 'glitter',
    hint: 'glitter',
    size: 1.35,
    opacity: 0.85,
    shimmer: 0.72,
    tempo: 1.15,
    peaks: 5.1,
    peakTime: 2.8,
  },
  frost: { effect: 'glitter', hint: 'frost' },
  mist: { effect: 'mist', hint: 'mist' },
  // The defaults Kait tuned in prototypes/stars.html (task 076).
  stars: {
    effect: 'stars',
    hint: 'stars',
    opacity: 0.75,
    peaks: 0.4,
    peakTime: 1.2,
    peakSize: 1.6,
  },
  aurora: { effect: 'aurora', hint: 'aurora', opacity: 0.95 },
  none: { effect: null, hint: 'none' },
} satisfies Record<string, Preset>

type PresetName = keyof typeof PRESETS

// An image's weather in a theme: its preset and the fields it changes, and a second effect drawn
// over it (`also`).
type Entry = Tuning & { preset: PresetName; also?: Entry }

// An image's weather, in `both` themes or in each. `horizon`: where the sea, the ice, or the
// ground meets the sky or the tree line, as a fraction of the image's height; glitter grows toward
// the viewer below it, and shear starts there. `zones`: the entries' zones, unless an entry sets
// its own. A recomposed image updates its horizon, bands, and zones.
type ImageWeather = { horizon?: number; zones?: Zone[] } & (
  | { both: Entry }
  | { light: Entry; dark: Entry }
)

function wx(preset: PresetName, tuning: Tuning = {}, also?: Entry): Entry {
  return also ? { preset, ...tuning, also } : { preset, ...tuning }
}

// Wet snow by day: the far flakes grey-blue, so they show against the pale sky.
const WET_SNOW: Partial<Colors> = {
  image: [
    [0.96, 0.97, 1],
    [0.64, 0.71, 0.8],
  ],
}

// The coast's seeds and motes over the picture: warm mid-tones, since the default near-white
// vanishes against the pale coast skies.
const COAST_SPECKS: Partial<Colors> = {
  image: [
    [0.7, 0.68, 0.62],
    [0.62, 0.52, 0.34],
  ],
}

// Each image's weather from what it shows; task 066 records why.
export const IMAGE_WEATHER: Record<ImageId, ImageWeather> = {
  winter: { both: wx('snow', { wind: -0.02 }) },
  spring: { both: wx('rain', { wind: 0.22 }) },
  summer: { light: wx('seeds', { wind: 0.028 }), dark: wx('fireflies') },
  autumn: { both: wx('leaves', { wind: 0.026 }) },
  'coast-january': {
    horizon: 0.38,
    // Brighter on the ice than on the snowy shore, and brightest on the sunny side by day and
    // around the moon's path by night, most along the path itself. Each zone gets an equal share
    // of the specks.
    light: wx('glitter', {
      zones: [
        [0, 0.4, 0.55, 0.82, 0.9],
        [0.55, 0.4, 1, 0.82, 1.25],
        [0, 0.82, 1, 1, 0.5],
      ],
      amount: 4,
      size: 2.3,
      opacity: 1.05,
      shimmer: 0.8,
      tempo: 1.3,
      peaks: 3.3,
      peakTime: 2.6,
      peakSize: 2.3,
    }),
    // Land February's night, a little fainter and slower, gathered along the moon's path.
    dark: wx('glitter-night', {
      zones: [
        [0, 0.4, 0.62, 0.82, 0.8],
        [0.62, 0.4, 0.92, 0.75, 1.2],
        [0, 0.82, 1, 1, 0.4],
        [0.74, 0.39, 0.8, 0.7, 1.6],
      ],
      // A quarter of the specks per zone, so each of the first three keeps a third's worth.
      amount: 1.33,
      opacity: 0.75,
      tempo: 1,
      peakTime: 3.2,
    }),
  },
  'coast-february': {
    horizon: 0.43,
    light: wx('blowing', {
      amount: 0.55,
      size: 1.2,
      opacity: 1.3,
      fall: 2.35,
      wind: 0.2,
      gust: 1,
      shear: 5,
    }),
    dark: wx('blowing', { amount: 0.2, size: 1.15, opacity: 0.85, fall: 3, wind: -0.24 }),
  },
  // Wet snow blowing in off the sea, on the right, falling faster than dry flakes.
  'coast-march': {
    horizon: 0.51,
    light: wx('flurries', {
      wind: -0.15,
      gust: 0.5,
      shear: 1,
      amount: 0.6,
      size: 1.4,
      fall: 1.3,
      colors: WET_SNOW,
    }),
    // A clear night under a bright moon: stars in place of the flurries.
    dark: wx('stars', {
      count: 24,
      seed: 89,
      opacity: 0.6,
      sky: [
        [
          [0.02, 0.02],
          [0.98, 0.02],
          [0.98, 0.45],
          [0.9, 0.35],
          [0.75, 0.28],
          [0.62, 0.35],
          [0.6, 0.45],
          [0.02, 0.45],
        ],
      ],
      moon: [0.36, 0.29, 0.07],
    }),
  },
  'coast-april': {
    horizon: 0.55,
    light: wx('motes-fine', { wind: -0.02, size: 0.9, opacity: 0.95, colors: COAST_SPECKS }),
    // Sea fog below the moon, clear of the cliff, and stars away from the moon.
    dark: wx(
      'mist',
      { wind: -0.01, zones: [[0, 0.48, 0.68, 0.72]], opacity: 0.8 },
      wx('stars', {
        count: 16,
        seed: 89,
        opacity: 0.5,
        sky: [
          [
            [0.02, 0.02],
            [0.64, 0.02],
            [0.66, 0.4],
            [0.02, 0.4],
          ],
        ],
        moon: [0.18, 0.36, 0.07],
      }),
    ),
  },
  'coast-may': {
    horizon: 0.53,
    light: wx('seeds-fine', { wind: 0.03, amount: 0.6, colors: COAST_SPECKS }),
    // A bright early-summer night: stars in place of the seeds.
    dark: wx('stars', {
      count: 42,
      seed: 96,
      opacity: 0.5,
      spread: 0.8,
      sky: [
        [
          [0.22, 0.02],
          [0.98, 0.02],
          [0.98, 0.42],
          [0.22, 0.42],
        ],
      ],
    }),
  },
  'coast-june': {
    horizon: 0.47,
    light: wx('seeds-fine', { wind: -0.08, gust: 0.4, colors: COAST_SPECKS }),
    dark: wx('seeds-fine', { wind: -0.08, gust: 0.4, amount: 0.75, opacity: 0.75 }),
  },
  'coast-july': {
    horizon: 0.74,
    light: wx('seeds-fine', { wind: 0.03, colors: COAST_SPECKS }),
    // Fewer, slower fireflies under a moonless sky, so the two don't look busy together.
    dark: wx(
      'fireflies',
      { amount: 0.18, tempo: 0.55 },
      wx('stars', {
        sky: [
          [
            [0.02, 0.02],
            [0.98, 0.02],
            [0.98, 0.35],
            [0.85, 0.3],
            [0.8, 0.18],
            [0.65, 0.17],
            [0.6, 0.45],
            [0.02, 0.48],
          ],
        ],
      }),
    ),
  },
  'coast-august': {
    horizon: 0.45,
    light: wx('motes', { wind: 0.008, colors: COAST_SPECKS }),
    // On the open water, fading out at the rocks on the left: across the rocks it lay as a flat
    // smear. Half the banks lie low and heavier along the island's foot, below the trunks. Half
    // stay in their zones, so the island has mist from the start, clearing now and then.
    // Stars above the clouds, out of the small moon's glow.
    dark: wx(
      'mist',
      {
        wind: 0.01,
        gather: 0.5,
        zones: [
          [0.34, 0.42, 1, 0.6, 0.8],
          [0.64, 0.41, 1, 0.47, 3],
        ],
        amount: 2,
        size: 1.3,
        opacity: 1.2,
      },
      wx('stars', {
        count: 42,
        seed: 90,
        opacity: 0.4,
        sky: [
          [
            [0.15, 0.02],
            [0.98, 0.02],
            [0.98, 0.3],
            [0.5, 0.3],
            [0.5, 0.2],
            [0.15, 0.2],
          ],
        ],
        moon: [0.69, 0.345, 0.06],
      }),
    ),
  },
  'coast-september': {
    horizon: 0.48,
    light: wx('seeds-fine', {
      wind: 0.16,
      gust: 0.5,
      fall: 0.5,
      size: 0.3,
      amount: 0.7,
      colors: COAST_SPECKS,
    }),
    // Thick fog, drifting the way the grass leans: over the bay and the far shore, low in the
    // reeds right of the haystack, and thinner over the near grass at its foot, so it stays off
    // the haystack itself.
    dark: wx('mist', {
      wind: 0.012,
      zones: [
        [0.25, 0.4, 1, 0.58, 1.2],
        [0.33, 0.5, 1, 0.78],
        [0, 0.72, 1, 0.97, 0.6],
      ],
      amount: 1.6,
      size: 1.3,
      opacity: 1.1,
    }),
  },
  // The waves break from the right. By night, a few stars in the gaps between the clouds.
  'coast-october': {
    horizon: 0.58,
    light: wx('squall', { wind: -0.6 }),
    dark: wx(
      'squall',
      { wind: -0.6 },
      wx('stars', {
        count: 10,
        seed: 85,
        opacity: 0.45,
        sky: [
          [
            [0.03, 0.02],
            [0.4, 0.02],
            [0.35, 0.1],
            [0.15, 0.2],
            [0.03, 0.2],
          ],
          [
            [0.45, 0.01],
            [0.97, 0.01],
            [0.97, 0.06],
            [0.45, 0.06],
          ],
        ],
        moon: [0.6, 0.43, 0.08],
      }),
    ),
  },
  'coast-november': {
    horizon: 0.43,
    light: wx('spray', { wind: -0.5, band: [0.3, 1.05] }),
    dark: wx('mist', { wind: -0.03 }),
  },
  // A few flakes blowing in off the sea, on the right.
  'coast-december': {
    horizon: 0.36,
    light: wx('blowing', {
      wind: -0.2,
      amount: 0.12,
      size: 1.1,
      fall: 2.5,
      shear: 2,
      colors: WET_SNOW,
    }),
    // Under the cloudless night sky, fewer and fainter.
    dark: wx('blowing', {
      wind: -0.2,
      amount: 0.06,
      size: 1.1,
      opacity: 0.7,
      fall: 2.5,
      shear: 2,
    }),
  },
  // Sparse snow on the stream by day; by night the moonlit snow glitters, as February's.
  'land-january': {
    horizon: 0.35,
    light: wx('flurries', { amount: 0.22, size: 1.45, fall: 0.75 }),
    // The snow off the stream, glinting most in the moonlight under the moon, less over the far
    // field, on the bank and the bush right of the stream, and on the moon's reflection.
    dark: wx('glitter-night', {
      zones: [
        [0.36, 0.35, 1, 0.47, 1.1],
        [0.58, 0.35, 0.74, 0.55, 1.5],
        [0.63, 0.47, 1, 0.66, 0.95],
        [0.59, 0.67, 0.69, 0.86, 1],
      ],
      // A quarter of the specks per zone, so each of the first three keeps a third's worth.
      amount: 1.33,
    }),
  },
  // The lake's snow away from the jetty, which doesn't glint. Each zone gets a third of the
  // specks, so the small second one, around the sun's and the moon's reflection, glints most.
  'land-february': {
    horizon: 0.43,
    zones: [
      [0, 0.46, 0.7, 0.62],
      [0.7, 0.46, 1, 0.8, 1.25],
      [0.36, 0.62, 1, 1],
    ],
    // Strong, or it doesn't show on the bright snow; very little snow instead if it still doesn't.
    light: wx('glitter', {
      amount: 4,
      size: 2.8,
      opacity: 1.5,
      shimmer: 1,
      tempo: 1.7,
      peaks: 6,
      peakTime: 2.6,
      peakSize: 3,
    }),
    dark: wx('glitter-night'),
  },
  // Wet snow over the thawing bog, in a gentler wind than on the coast.
  'land-march': {
    horizon: 0.31,
    light: wx('flurries', {
      wind: 0.06,
      gust: 0.4,
      shear: 0.5,
      amount: 0.5,
      size: 1.3,
      fall: 1.3,
      colors: WET_SNOW,
    }),
    // On the bog's water.
    dark: wx('mist', { wind: 0.008, zones: [[0, 0.3, 1, 0.68]], amount: 1.3, opacity: 1.3 }),
  },
  // By day, clear skies, as on the coast.
  'land-april': {
    horizon: 0.75,
    light: wx('motes-fine', { wind: 0.01, size: 0.9, opacity: 0.95 }),
    // Ground mist at the foot of the near trunks, just above the flower bed, fainter along the far
    // trees, and hardly any by the manor. A few stars in the moonless sky right of the trees.
    dark: wx(
      'mist',
      {
        wind: 0.006,
        zones: [
          [0, 0.67, 0.42, 0.79, 1.1],
          [0.35, 0.64, 0.78, 0.76, 0.6],
        ],
        amount: 1.1,
        opacity: 0.75,
      },
      wx('stars', {
        count: 5,
        seed: 96,
        sky: [
          [
            [0.54, 0.02],
            [0.99, 0.02],
            [0.99, 0.46],
            [0.54, 0.5],
          ],
        ],
      }),
    ),
  },
  'land-may': {
    horizon: 0.75,
    light: wx('seeds', { wind: 0.015, share: 0.5, amount: 2.5, size: 0.5 }),
    // A bright early-summer night, so only a few stars.
    dark: wx(
      'mist',
      { wind: 0.008 },
      wx('stars', {
        count: 11,
        seed: 72,
        sky: [
          [
            [0.12, 0.02],
            [0.66, 0.02],
            [0.58, 0.3],
            [0.55, 0.55],
            [0.22, 0.55],
            [0.12, 0.3],
          ],
        ],
      }),
    ),
  },
  'land-june': {
    horizon: 0.44,
    light: wx('seeds', { wind: 0.015, amount: 2.5, size: 0.6, opacity: 0.9, gust: 0 }),
    dark: wx('fireflies', { amount: 2.2, size: 0.5, opacity: 0.75 }),
  },
  // By night, midges mostly by the cliff, the rest over the river, and the fireflies on the far
  // bank. By day, all by the cliff, where they show.
  'land-july': {
    horizon: 0.76,
    light: wx('midges', {
      wind: 0.005,
      zones: [
        [0.05, 0.64, 0.33, 0.9],
        [0.05, 0.64, 0.33, 0.9],
      ],
      amount: 1.95,
      tempo: 1.15,
    }),
    // Stars out of the bright moon's glow, low on the right.
    dark: wx(
      'midges-night',
      {
        wind: 0.005,
        zones: [
          [0.05, 0.64, 0.33, 0.9],
          [0.34, 0.82, 0.88, 0.97],
          [0.58, 0.68, 1, 0.78],
        ],
      },
      wx('stars', {
        count: 50,
        seed: 75,
        sky: [
          [
            [0.23, 0.02],
            [0.98, 0.02],
            [0.98, 0.56],
            [0.29, 0.56],
            [0.25, 0.2],
          ],
        ],
        moon: [0.855, 0.48, 0.07],
      }),
    ),
  },
  'land-august': {
    horizon: 0.39,
    light: wx('dust', { wind: 0.03 }),
    dark: wx('mist', { wind: 0.01 }),
  },
  'land-september': {
    horizon: 0.68,
    // Early autumn's leaves, from the birches and rowans.
    light: wx('leaves', {
      wind: 0.07,
      gust: 0.5,
      amount: 0.15,
      colors: {
        image: [
          [0.84, 0.68, 0.18],
          [0.78, 0.36, 0.14],
        ],
        plain: [
          [0.84, 0.68, 0.18],
          [0.78, 0.36, 0.14],
        ],
      },
    }),
    dark: wx('mist', { wind: 0.008, amount: 1.4, size: 1.2 }),
  },
  // Smaller and fainter, so they sit in the tinted picture rather than in front of it.
  'land-october': {
    horizon: 0.77,
    light: wx('leaves', { wind: 0.04, amount: 1.3, size: 0.7, opacity: 0.65 }),
    // The moonlit trees are near grey, so the leaves are dull rust and olive, not bright orange.
    // A few stars between the crescent moon and the small clouds.
    dark: wx(
      'leaves',
      {
        wind: 0.04,
        size: 0.7,
        opacity: 0.6,
        colors: {
          dark: [
            [0.42, 0.3, 0.18],
            [0.5, 0.44, 0.26],
          ],
        },
      },
      wx('stars', {
        count: 10,
        seed: 7,
        sky: [
          [
            [0.02, 0.02],
            [0.56, 0.02],
            [0.53, 0.58],
            [0.25, 0.58],
            [0.25, 0.44],
            [0.02, 0.42],
          ],
        ],
        moon: [0.245, 0.375, 0.05],
      }),
    ),
  },
  'land-november': {
    horizon: 0.57,
    zones: [[0, 0.6, 1, 1]],
    light: wx('frost', {
      amount: 2.9,
      size: 2.4,
      opacity: 1.05,
      shimmer: 1,
      peaks: 2.9,
      peakTime: 2.6,
      peakSize: 3.1,
    }),
    // A moonless sky: stars in place of the frost, which barely caught light.
    dark: wx('stars', {
      count: 52,
      seed: 88,
      opacity: 0.6,
      sky: [
        [
          [0.17, 0.02],
          [0.86, 0.02],
          [0.84, 0.3],
          [0.81, 0.46],
          [0.17, 0.46],
        ],
      ],
    }),
  },
  'land-december': {
    horizon: 0.74,
    light: wx('snow', { amount: 0.3, fall: 0.8 }),
    // A clear, moonless night: the aurora and stars in place of the snow, low on the left: a thin
    // band just over the treeline, a curtain above it whose edge bends down into a bright hook, a
    // faint arc over the hook, and a faint glow on the left.
    dark: wx(
      'aurora',
      {
        curtains: [
          {
            base: [
              [-0.036, 0.704],
              [0.096, 0.702],
              [0.204, 0.7],
              [0.276, 0.698],
              [0.324, 0.697],
            ],
            height: 0.035,
            gain: 0.7,
          },
          {
            base: [
              [-0.036, 0.673],
              [0.096, 0.669],
              [0.192, 0.667],
              [0.258, 0.669],
              [0.3, 0.677],
              [0.326, 0.69],
              [0.341, 0.699],
            ],
            height: 0.075,
            gain: 1,
            lean: 0.3,
          },
          {
            base: [
              [0.156, 0.588],
              [0.216, 0.6],
              [0.264, 0.614],
              [0.3, 0.63],
              [0.319, 0.642],
            ],
            height: 0.035,
            gain: 0.28,
            lean: 0.3,
          },
          {
            base: [
              [-0.036, 0.648],
              [0.06, 0.642],
              [0.156, 0.638],
              [0.216, 0.64],
            ],
            height: 0.05,
            gain: 0.3,
          },
        ],
      },
      wx('stars', {
        seed: 90,
        opacity: 0.5,
        sky: [
          [
            [0.02, 0.02],
            [0.7, 0.02],
            [0.68, 0.15],
            [0.62, 0.4],
            [0.57, 0.55],
            [0.02, 0.55],
          ],
        ],
      }),
    ),
  },
}

// An image's weather in a theme, resolved: its preset, then the image's horizon and fields, and
// its second effect, which takes the horizon but not the zones.
export type Weather = Preset & { horizon?: number; also?: Weather }

export function weatherFor(id: ImageId, theme: 'light' | 'dark'): Weather {
  const { horizon, zones, ...image } = IMAGE_WEATHER[id]
  const { preset, also, ...tuning } = 'both' in image ? image.both : image[theme]
  const weather = { ...PRESETS[preset], horizon, zones, ...tuning }
  if (!also) return weather
  const { preset: second, also: _, ...more } = also
  return { ...weather, also: { ...PRESETS[second], horizon, ...more } }
}

// Why the weather can't run here, for the Weather hint: 'webgl' without WebGL 2, 'failed' when
// the shown effect didn't compile. SceneLayer sets it.
const [weatherProblem, setWeatherProblem] = createSignal<'webgl' | 'failed' | null>(null)
export { setWeatherProblem, weatherProblem }

// Whether the browser has WebGL 2 at all. A context can still fail to start, for example on a
// blocked GPU; createWeatherRenderer returns null then.
export function weatherSupported() {
  return typeof WebGL2RenderingContext !== 'undefined'
}
