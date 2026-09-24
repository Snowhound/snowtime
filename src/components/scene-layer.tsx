// The seasonal scene behind the signed-in pages and the sign-in page (prototypes/scene.js,
// prototypes/README.md, "Seasonal scene in the app"): the season's image in light and dark, which
// crossfade with the theme, and the tint at the Strength setting. The frame that renders it is
// `isolate` and carries sceneAttributes(), so the layer sits behind the frame's content and the
// surfaces follow the settings (src/styles.css).
import { createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import {
  PHOTO_SMALL,
  type PhotoTheme,
  STRENGTHS,
  type SceneSettings,
  currentSeason,
  loadPhoto,
  photoReady,
  photoUrl,
  photoWidth,
} from '~/lib/scene'

type LayerSettings = Pick<SceneSettings, 'sceneSeason' | 'sceneBackground' | 'sceneStrength'>

function background(src: string) {
  return src ? `url("${src}")` : undefined
}

export function SceneLayer(props: { settings: LayerSettings }) {
  const [dark, setDark] = createSignal(false)
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
        if (on && theme === shown) void loadPhoto(sharp).then(() => setLoaded((n) => n + 1))
        const due = theme === shown || shownReady
        const current = untrack(src)
        if (on && due && !current.includes(`/${season}-${theme}-`)) {
          setSrc(photoUrl(season, theme, PHOTO_SMALL))
        }
      }
    })
  })

  return (
    <div
      class="scene"
      aria-hidden="true"
      data-background={props.settings.sceneBackground ? 'on' : 'off'}
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
    </div>
  )
}
