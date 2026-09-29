// The seasonal scene behind the signed-in pages and the sign-in page (prototypes/scene.js,
// prototypes/README.md, "Seasonal scene in the app"): the collection's image in light and dark,
// which crossfade with the theme, the tint at the Strength setting, and the image's weather
// (src/lib/scene/weather.ts) at the page's pace. The frame that renders it is
// `isolate` and carries sceneAttributes(), so the layer sits behind the frame's content and the
// surfaces follow the settings (src/styles.css).
import { For, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { intro } from '~/lib/scene/intro'
import {
  PHOTO_SMALL,
  type PhotoTheme,
  STRENGTHS,
  type ImageId,
  type SceneSettings,
  createReducedMotion,
  imageFor,
  imageSeason,
  loadPhoto,
  photoReady,
  photoUrl,
  photoWidth,
  themeSwitchLikely,
} from '~/lib/scene/scene'
import {
  type Effect,
  PACES,
  type Pace,
  type WeatherRenderer,
  createWeatherRenderer,
  setWeatherProblem,
  weatherColors,
  weatherFor,
  weatherSupported,
} from '~/lib/scene/weather'

type LayerSettings = Pick<
  SceneSettings,
  'sceneCollection' | 'scenePin' | 'sceneBackground' | 'sceneStrength' | 'sceneWeather'
>

// A theme's pictures, oldest first. A new image fades in over the one before, which goes once
// the fade ends; a sharper file of the same image replaces the top one in place.
type Photo = { image: ImageId; src: string }

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
  function show(theme: PhotoTheme, image: ImageId, src: string) {
    if (untrack(() => photos[theme].at(-1)?.image) === image) {
      // A sharper file of the image on top: swap it in place, without a fade.
      setPhotos(theme, (p) => p.image === image, 'src', src)
    } else if (untrack(reducedMotion)) {
      // No fade, so nothing needs to stay underneath.
      setPhotos(theme, [{ image, src }])
    } else {
      // A new image: fade in on top. An image already in the stack moves up rather than
      // showing twice.
      setPhotos(theme, (list) => [...list.filter((p) => p.image !== image), { image, src }])
    }
  }
  function faded(theme: PhotoTheme, image: ImageId) {
    setPhotos(theme, (list) => {
      const i = list.findIndex((p) => p.image === image)
      return i > 0 ? list.slice(i) : list
    })
  }
  // The image the settings ask for. The browser picks it, since only it knows the date.
  const wantedImage = createMemo(() => imageFor(props.settings))
  // The weather follows the picture that shows, so an image change switches both as its
  // picture starts to fade in. An image's weather fits only its picture, so without the
  // background it's the season's, as the mountain images have it; the intro, which fades the
  // picture in, keeps the image's.
  const weatherImage = createMemo(() => {
    if (!props.settings.sceneBackground) {
      return intro.playing() ? wantedImage() : imageSeason(wantedImage())
    }
    return photos[dark() ? 'dark' : 'light'].at(-1)?.image ?? wantedImage()
  })

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
    // Once a picture shows, a new image loads the file for this screen straight away. The other
    // theme gets its small file after that, for the crossfade, once a switch is likely. A layer shows a file only once it
    // has decoded, and fades it in. Nothing loads while the background is off. It starts once
    // the theme and the screen are known.
    createEffect(() => {
      loaded()
      const image = wantedImage()
      const on = props.settings.sceneBackground
      const shown: PhotoTheme = dark() ? 'dark' : 'light'
      const shownReady = photoReady(photoUrl(image, shown, width()))
      for (const theme of ['light', 'dark'] as const) {
        const sharp = photoUrl(image, theme, width())
        if (photoReady(sharp)) {
          show(theme, image, sharp)
          continue
        }
        const small = photoUrl(image, theme, PHOTO_SMALL)
        const due = on && (theme === shown || (shownReady && themeSwitchLikely()))
        // The theme not on screen drops an earlier image, so switching themes never shows it, and
        // loads the new one's small file for the crossfade.
        if (theme !== shown && untrack(() => photos[theme].at(-1)?.image) !== image) {
          setPhotos(theme, [])
        }
        const showing = untrack(() => photos[theme].length > 0)
        // The intro opens without the background and fades the dark image in later, so its
        // sharp file loads meanwhile.
        const wanted = (on && theme === shown) || (intro.playing() && theme === 'dark')
        if (wanted && (photoReady(small) || !due || showing)) void load(sharp)
        if (!due) continue
        if (photoReady(small)) show(theme, image, small)
        else if (!showing) void load(small)
      }
    })

    // The weather runs while its switch is on, the device doesn't reduce motion, and the tab
    // shows. Its WebGL context starts the first time it runs, so with the switch off there's
    // none. An image without weather in this theme leaves it off. An effect that fails to compile
    // stays off, and the Weather hint says why.
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
      const weather = weatherFor(weatherImage(), isDark ? 'dark' : 'light')
      const { effect } = weather
      let on =
        effect !== null &&
        props.settings.sceneWeather &&
        !reducedMotion() &&
        visible() &&
        !failed.has(effect)
      if (on && renderer === undefined) {
        renderer = createWeatherRenderer(canvas, () => PACES[props.pace])
        if (!renderer) setWeatherProblem('webgl')
      }
      if (renderer && on && effect) {
        const shown = { ...weather, effect }
        try {
          renderer.start(shown, weatherColors(shown, { dark: isDark, background }))
        } catch (error) {
          console.warn(`Weather effect ${effect} unavailable:`, error)
          failed.add(effect)
          on = false
        }
      }
      if (!on) renderer?.stop()
      if (renderer !== null) setWeatherProblem(effect && failed.has(effect) ? 'failed' : null)
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
                  onAnimationEnd={() => faded(theme, photo.image)}
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
