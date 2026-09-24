// The seasonal scene's settings and seasons (prototypes/README.md, "Seasonal scene in the app";
// prototypes/seasons.js). The sceneSeason setting is 'auto', which follows the month, or one of
// the four.
import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js'
import { m } from '~/paraglide/messages.js'
import type { SCENE_SEASONS, UpdateSettingsInput } from '~/server/settings/settings.schemas'

export type SceneSettings = Required<
  Pick<
    UpdateSettingsInput,
    'sceneSeason' | 'sceneBackground' | 'sceneStrength' | 'surfaces' | 'sceneWeather' | 'sceneIntro'
  >
>

// The user_settings defaults, for signed-out pages.
export const SCENE_DEFAULTS: SceneSettings = {
  sceneSeason: 'auto',
  sceneBackground: true,
  sceneStrength: 'dimmed',
  surfaces: 'glass',
  sceneWeather: true,
  sceneIntro: true,
}

export type SceneSeasonSetting = (typeof SCENE_SEASONS)[number]
export type Season = Exclude<SceneSeasonSetting, 'auto'>

export const SEASONS: { id: Season; label: () => string; weather: () => string }[] = [
  { id: 'winter', label: m.season_winter, weather: m.scene_weather_winter },
  { id: 'spring', label: m.season_spring, weather: m.scene_weather_spring },
  { id: 'summer', label: m.season_summer, weather: m.scene_weather_summer },
  { id: 'autumn', label: m.season_autumn, weather: m.scene_weather_autumn },
]

// The season by month, northern hemisphere: December to February is winter.
export function seasonByMonth(date = new Date()): Season {
  const seasons: Season[] = ['winter', 'spring', 'summer', 'autumn']
  return seasons[Math.floor(((date.getMonth() + 1) % 12) / 3)]
}

// The season a setting shows: the chosen one, or the month's.
export function currentSeason(setting: SceneSeasonSetting, date = new Date()): Season {
  return setting === 'auto' ? seasonByMonth(date) : setting
}

export function season(id: Season) {
  return SEASONS.find((s) => s.id === id)!
}

// Whether the device asks for reduced motion, which keeps the weather and the intro off. False
// on the server and until hydration, since only the browser knows.
export function createReducedMotion(): Accessor<boolean> {
  const [reduced, setReduced] = createSignal(false)
  onMount(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    function update() {
      setReduced(query.matches)
    }
    update()
    query.addEventListener('change', update)
    onCleanup(() => query.removeEventListener('change', update))
  })
  return reduced
}

// How much of the page color covers the image, dark / light (prototypes/README.md, "Scenery
// menu"). The tint is stronger toward the bottom, where the text sits.
export const STRENGTHS = {
  full: { dark: 0.3, light: 0.2 },
  dimmed: { dark: 0.55, light: 0.5 },
} as const

export type PhotoTheme = 'light' | 'dark'

// Each image comes 1920 and 3840 px wide (design/backgrounds/README.md). `cover` stretches it to
// the larger of the viewport's width and its height's 16:9 width, times the pixel ratio (at most
// 2); past 2400 device pixels the large file is sharper. Screens under 768 px always get the small
// one.
export const PHOTO_SMALL = 1920
export const PHOTO_LARGE = 3840

export function photoWidth(viewport: { width: number; height: number; dpr: number }) {
  if (viewport.width < 768) return PHOTO_SMALL
  const needed =
    Math.max(viewport.width, (viewport.height * 16) / 9) * Math.min(viewport.dpr || 1, 2)
  return needed > PHOTO_SMALL * 1.25 ? PHOTO_LARGE : PHOTO_SMALL
}

export function photoUrl(season: Season, theme: PhotoTheme, width: number) {
  return `/backgrounds/${season}-${theme}-01-${width}.webp`
}

// Files loaded and decoded, so a layer only switches to an image that's ready to paint. Each file
// loads once; one that fails stays out of `photoReady`.
const ready = new Set<string>()
const loading = new Map<string, Promise<void>>()

export function photoReady(url: string) {
  return ready.has(url)
}

export function loadPhoto(url: string): Promise<void> {
  let promise = loading.get(url)
  if (!promise) {
    const img = new Image()
    img.src = url
    promise = img.decode().then(
      () => void ready.add(url),
      () => {},
    )
    loading.set(url, promise)
  }
  return promise
}

// The data attributes a frame with the scene carries; src/styles.css styles its surfaces, header,
// and page text from them.
export function sceneAttributes(settings: Pick<SceneSettings, 'sceneBackground' | 'surfaces'>) {
  return {
    'data-scene-bg': settings.sceneBackground ? 'on' : 'off',
    'data-surfaces': settings.surfaces,
  } as const
}
