// The seasonal scene behind the signed-in pages and the sign-in page (prototypes/scene.js,
// prototypes/README.md, "Seasonal scene in the app"): the season's image in light and dark, which
// crossfade with the theme, the tint at the Strength setting, and the season's weather
// (src/lib/weather.ts) at the page's pace. The frame that renders it is
// `isolate` and carries sceneAttributes(), so the layer sits behind the frame's content and the
// surfaces follow the settings (src/styles.css).
import { createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import { intro } from '~/lib/intro'
import {
  PHOTO_SMALL,
  type PhotoTheme,
  STRENGTHS,
  type SceneSettings,
  createReducedMotion,
  currentSeason,
  loadPhoto,
  photoReady,
  photoUrl,
  photoWidth,
} from '~/lib/scene'
import {
  EFFECTS,
  type Effect,
  PACES,
  type Pace,
  SEASON_EFFECTS,
  createWeatherRenderer,
  setWeatherProblem,
} from '~/lib/weather'

type LayerSettings = Pick<
  SceneSettings,
  'sceneSeason' | 'sceneBackground' | 'sceneStrength' | 'sceneWeather'
>

function background(src: string) {
  return src ? `url("${src}")` : undefined
}

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
  const [lightSrc, setLightSrc] = createSignal('')
  const [darkSrc, setDarkSrc] = createSignal('')

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

    // The shown theme gets the small file at once and the file for this screen once it has
    // decoded, so the picture sharpens without moving. The other theme gets its small file after
    // that, for the crossfade. Nothing loads while the background is off. It starts once the
    // theme and the screen are known.
    createEffect(() => {
      loaded()
      const season = currentSeason(props.settings.sceneSeason)
      const on = props.settings.sceneBackground
      const shown: PhotoTheme = dark() ? 'dark' : 'light'
      const shownReady = photoReady(photoUrl(season, shown, width()))
      for (const theme of ['light', 'dark'] as const) {
        const [src, setSrc] = theme === 'light' ? [lightSrc, setLightSrc] : [darkSrc, setDarkSrc]
        const sharp = photoUrl(season, theme, width())
        if (photoReady(sharp)) {
          setSrc(sharp)
          continue
        }
        // The intro opens without the background and fades the dark image in later, so its
        // sharp file loads meanwhile.
        const wanted = (on && theme === shown) || (intro.playing() && theme === 'dark')
        if (wanted) void loadPhoto(sharp).then(() => setLoaded((n) => n + 1))
        const due = theme === shown || shownReady
        const current = untrack(src)
        if (on && due && !current.includes(`/${season}-${theme}-`)) {
          setSrc(photoUrl(season, theme, PHOTO_SMALL))
        }
      }
    })

    // The weather runs while its switch is on, the device doesn't reduce motion, and the tab
    // shows. An effect that fails to compile stays off, and the Weather hint says why.
    const renderer = createWeatherRenderer(canvas, () => PACES[props.pace])
    setWeatherProblem(renderer ? null : 'webgl')
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
      const effect =
        SEASON_EFFECTS[currentSeason(props.settings.sceneSeason)][isDark ? 'dark' : 'light']
      let on = props.settings.sceneWeather && !reducedMotion() && visible() && !failed.has(effect)
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
      if (renderer) setWeatherProblem(failed.has(effect) ? 'failed' : null)
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
      <div
        class="scene-photo scene-photo-light"
        style={{ 'background-image': background(lightSrc()) }}
      />
      <div
        class="scene-photo scene-photo-dark"
        style={{ 'background-image': background(darkSrc()) }}
      />
      <div class="scene-tint" />
      <div class="scene-vignette" />
      <canvas ref={canvas} class="scene-weather" data-on={weatherOn() ? '' : undefined} />
    </div>
  )
}
