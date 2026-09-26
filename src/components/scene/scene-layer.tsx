// The seasonal scene behind the signed-in pages and the sign-in page (prototypes/scene.js,
// prototypes/README.md, "Seasonal scene in the app"): the season's image in light and dark, which
// crossfade with the theme, the tint at the Strength setting, and the season's weather
// (src/lib/scene/weather.ts) at the page's pace. The frame that renders it is
// `isolate` and carries sceneAttributes(), so the layer sits behind the frame's content and the
// surfaces follow the settings (src/styles.css).
import { For, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { intro } from '~/lib/scene/intro'
import {
  PHOTO_SMALL,
  type PhotoFormat,
  type PhotoTheme,
  STRENGTHS,
  type SceneSettings,
  type Season,
  createReducedMotion,
  currentSeason,
  loadPhoto,
  photoReady,
  photoFormat,
  photoUrl,
  photoWidth,
} from '~/lib/scene/scene'
import {
  EFFECTS,
  type Effect,
  PACES,
  type Pace,
  SEASON_EFFECTS,
  type WeatherRenderer,
  createWeatherRenderer,
  setWeatherProblem,
  weatherSupported,
} from '~/lib/scene/weather'

type LayerSettings = Pick<
  SceneSettings,
  'sceneSeason' | 'sceneBackground' | 'sceneStrength' | 'sceneWeather'
>

// A theme's pictures, oldest first. A new season's picture fades in over the one before, which
// goes once the fade ends; a sharper file of the same season replaces the top one in place.
type Photo = { season: Season; src: string }

export function SceneLayer(props: { settings: LayerSettings; pace: Pace }) {
  const [dark, setDark] = createSignal(false)
  const reducedMotion = createReducedMotion()
  const [visible, setVisible] = createSignal(true)
  const [weatherOn, setWeatherOn] = createSignal(false)
  let canvas!: HTMLCanvasElement
  function visibility() {
    setVisible(!document.hidden)
  }
  const [width, setWidth] = createSignal(PHOTO_SMALL)
  // Bumped when a file has decoded, so the layers look again.
  const [loaded, setLoaded] = createSignal(0)
  async function load(url: string) {
    await loadPhoto(url)
    if (photoReady(url)) setLoaded((n) => n + 1)
  }
  const [photos, setPhotos] = createStore<Record<PhotoTheme, Photo[]>>({ light: [], dark: [] })
  function show(theme: PhotoTheme, season: Season, src: string) {
    if (untrack(() => photos[theme].at(-1)?.season) === season) {
      // A sharper file of the season on top: swap it in place, without a fade.
      setPhotos(theme, (p) => p.season === season, 'src', src)
    } else if (untrack(reducedMotion)) {
      // No fade, so nothing needs to stay underneath.
      setPhotos(theme, [{ season, src }])
    } else {
      // A new season: fade in on top. A season already in the stack moves up rather than
      // showing twice.
      setPhotos(theme, (list) => [...list.filter((p) => p.season !== season), { season, src }])
    }
  }
  function faded(theme: PhotoTheme, season: Season) {
    setPhotos(theme, (list) => {
      const i = list.findIndex((p) => p.season === season)
      return i > 0 ? list.slice(i) : list
    })
  }
  // The weather follows the picture that shows, so a season change switches both as its
  // picture starts to fade in.
  const sceneSeason = createMemo(() => {
    const setting = currentSeason(props.settings.sceneSeason)
    if (!props.settings.sceneBackground) return setting
    return photos[dark() ? 'dark' : 'light'].at(-1)?.season ?? setting
  })
  const [format, setFormat] = createSignal<PhotoFormat>()

  onMount(() => {
    const root = document.documentElement
    function update() {
      setDark(root.classList.contains('dark'))
      setWidth(photoWidth({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    addEventListener('resize', update)
    onCleanup(() => {
      observer.disconnect()
      removeEventListener('resize', update)
    })

    // On the first picture, the shown theme loads its small file first, on its own, so a picture
    // shows as soon as possible, then the file for this screen, so it sharpens without moving.
    // Once a picture shows, a new season loads the file for this screen straight away. The other
    // theme gets its small file after that, for the crossfade. A layer shows a file only once it
    // has decoded, and fades it in. Nothing loads while the background is off. It starts once
    // the theme, the screen, and the file format are known.
    void photoFormat().then(setFormat)
    createEffect(() => {
      loaded()
      const f = format()
      if (!f) return
      const season = currentSeason(props.settings.sceneSeason)
      const on = props.settings.sceneBackground
      const shown: PhotoTheme = dark() ? 'dark' : 'light'
      const shownReady = photoReady(photoUrl(season, shown, width(), f))
      for (const theme of ['light', 'dark'] as const) {
        const sharp = photoUrl(season, theme, width(), f)
        if (photoReady(sharp)) {
          show(theme, season, sharp)
          continue
        }
        const small = photoUrl(season, theme, PHOTO_SMALL, f)
        const due = on && (theme === shown || shownReady)
        const showing = untrack(() => photos[theme].length > 0)
        // The intro opens without the background and fades the dark image in later, so its
        // sharp file loads meanwhile.
        const wanted = (on && theme === shown) || (intro.playing() && theme === 'dark')
        if (wanted && (photoReady(small) || !due || showing)) void load(sharp)
        if (!due) continue
        if (photoReady(small)) show(theme, season, small)
        else if (!showing) void load(small)
      }
    })

    // The weather runs while its switch is on, the device doesn't reduce motion, and the tab
    // shows. Its WebGL context starts the first time it runs, so with the switch off there's
    // none. An effect that fails to compile stays off, and the Weather hint says why.
    let renderer: WeatherRenderer | null | undefined = weatherSupported() ? undefined : null
    setWeatherProblem(renderer === null ? 'webgl' : null)
    const failed = new Set<Effect>()
    visibility()
    document.addEventListener('visibilitychange', visibility)
    onCleanup(() => {
      document.removeEventListener('visibilitychange', visibility)
      renderer?.destroy()
    })
    createEffect(() => {
      const isDark = dark()
      const background = props.settings.sceneBackground
      const effect = SEASON_EFFECTS[sceneSeason()][isDark ? 'dark' : 'light']
      let on = props.settings.sceneWeather && !reducedMotion() && visible() && !failed.has(effect)
      if (on && renderer === undefined) {
        renderer = createWeatherRenderer(canvas, () => PACES[props.pace])
        if (!renderer) setWeatherProblem('webgl')
      }
      if (renderer && on) {
        try {
          renderer.start(effect, () => EFFECTS[effect].colors({ dark: isDark, background }))
        } catch (error) {
          console.warn(`Weather effect ${effect} unavailable:`, error)
          failed.add(effect)
          on = false
        }
      }
      if (!on) renderer?.stop()
      if (renderer !== null) setWeatherProblem(failed.has(effect) ? 'failed' : null)
      setWeatherOn(on && !!renderer)
    })
  })

  return (
    <div
      class="scene"
      aria-hidden="true"
      data-background={props.settings.sceneBackground ? 'on' : 'off'}
      data-intro={intro.playing() ? '' : undefined}
      style={{
        '--scene-tint-light': STRENGTHS[props.settings.sceneStrength].light,
        '--scene-tint-dark': STRENGTHS[props.settings.sceneStrength].dark,
      }}
    >
      <For each={['light', 'dark'] as const}>
        {(theme) => (
          <div
            class={`scene-photo scene-photo-${theme}`}
            data-ready={photos[theme].length > 0 ? '' : undefined}
          >
            <For each={photos[theme]}>
              {(photo) => (
                <div
                  class="scene-photo-image"
                  style={{ 'background-image': `url("${photo.src}")` }}
                  onAnimationEnd={() => faded(theme, photo.season)}
                />
              )}
            </For>
          </div>
        )}
      </For>
      <div class="scene-tint" />
      <div class="scene-vignette" />
      <canvas ref={canvas} class="scene-weather" data-on={weatherOn() ? '' : undefined} />
    </div>
  )
}
