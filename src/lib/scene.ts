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
