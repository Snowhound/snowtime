// The seasonal scene's settings, collections, and images (prototypes/README.md, "Seasonal scene
// in the app" and "Scenery collections"; prototypes/scene.js). The background comes from the
// sceneCollection setting's images by the calendar, or is the one scenePin names.
import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import {
  COLLECTION_IDS,
  COLLECTION_IMAGES,
  type CollectionId,
  type ImageId,
  MONTHS,
  SEASONS,
  type Season,
  inCollection,
} from './images'

export type { CollectionId, ImageId, Season }

export type SceneSettings = Required<
  Pick<
    UpdateSettingsInput,
    | 'sceneCollection'
    | 'scenePin'
    | 'sceneBackground'
    | 'sceneStrength'
    | 'surfaces'
    | 'sceneWeather'
    | 'sceneIntro'
  >
>

// The user_settings defaults, for signed-out pages.
export const SCENE_DEFAULTS: SceneSettings = {
  sceneCollection: 'mountains',
  scenePin: null,
  sceneBackground: true,
  sceneStrength: 'dimmed',
  surfaces: 'glass',
  sceneWeather: true,
  sceneIntro: true,
}

const SEASON_LABELS: Record<Season, () => string> = {
  winter: m.season_winter,
  spring: m.season_spring,
  summer: m.season_summer,
  autumn: m.season_autumn,
}

const COLLECTION_LABELS: Record<CollectionId, () => string> = {
  mountains: m.scene_collection_mountains,
  coast: m.scene_collection_coast,
  countryside: m.scene_collection_countryside,
}

type Collection = {
  id: CollectionId
  label: () => string
  description: () => string
  by: 'season' | 'month'
  images: readonly ImageId[]
}

export const COLLECTIONS: Collection[] = COLLECTION_IDS.map((id) => ({
  id,
  label: COLLECTION_LABELS[id],
  description: id === 'mountains' ? m.scene_collection_by_season : m.scene_collection_by_month,
  by: id === 'mountains' ? 'season' : 'month',
  images: COLLECTION_IMAGES[id],
}))

export function collection(id: CollectionId) {
  return COLLECTIONS.find((c) => c.id === id)!
}

// The month, 0 to 11, in the zone, or else in the runtime's.
function monthOf(date: Date, timeZone?: string) {
  if (!timeZone) return date.getMonth()
  return Number(new Intl.DateTimeFormat('en', { timeZone, month: 'numeric' }).format(date)) - 1
}

function seasonOfMonth(month: number): Season {
  return SEASONS[Math.floor(((month + 1) % 12) / 3)]
}

// The season by month, northern hemisphere: December to February is winter.
export function seasonByMonth(date = new Date(), timeZone?: string): Season {
  return seasonOfMonth(monthOf(date, timeZone))
}

// The month a Baltic image stands for, or null for a season's.
function imageMonth(id: ImageId) {
  const month = MONTHS.findIndex((name) => id.endsWith(`-${name}`))
  return month < 0 ? null : month
}

// The season an image belongs to, for the tagline and the intro.
export function imageSeason(id: ImageId): Season {
  const month = imageMonth(id)
  return month === null ? (id as Season) : seasonOfMonth(month)
}

function imageCollection(id: ImageId) {
  return COLLECTION_IDS.find((c) => inCollection(c, id)) ?? 'mountains'
}

function monthName(month: number, format: 'long' | 'short') {
  return new Intl.DateTimeFormat(getLocale(), { month: format, timeZone: 'UTC' }).format(
    Date.UTC(2026, month, 15),
  )
}

function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase(getLocale()) + text.slice(1)
}

// An image's name on its own: "March", "Winter".
export function imageLabel(id: ImageId) {
  const month = imageMonth(id)
  return month === null ? SEASON_LABELS[id as Season]() : capitalize(monthName(month, 'long'))
}

// An image's name within a sentence: "March" and "winter" in English, "märts" and "talv" in
// Estonian.
export function imageName(id: ImageId) {
  const month = imageMonth(id)
  return month === null
    ? SEASON_LABELS[id as Season]().toLocaleLowerCase(getLocale())
    : monthName(month, 'long')
}

// A gallery tile's label: "Mar", "Winter".
export function imageShort(id: ImageId) {
  const month = imageMonth(id)
  return month === null ? SEASON_LABELS[id as Season]() : capitalize(monthName(month, 'short'))
}

// The image the calendar shows in a collection. Without a zone, the month is the runtime's.
export function calendarImage(id: CollectionId, date = new Date(), timeZone?: string): ImageId {
  return id === 'mountains'
    ? seasonByMonth(date, timeZone)
    : COLLECTION_IMAGES[id][monthOf(date, timeZone)]
}

type Choice = Pick<SceneSettings, 'sceneCollection' | 'scenePin'>

// The pin, when it's one of the collection's images; the server refuses any other.
export function scenePin(settings: Choice) {
  const pin = settings.scenePin
  return pin && inCollection(settings.sceneCollection, pin) ? pin : null
}

// The image that shows: the pin, or the calendar's.
export function imageFor(settings: Choice, date = new Date(), timeZone?: string): ImageId {
  return scenePin(settings) ?? calendarImage(settings.sceneCollection, date, timeZone)
}

// The season of the image that shows, which the tagline's lines and colors follow.
export function shownSeason(settings: Choice, date = new Date(), timeZone?: string) {
  return imageSeason(imageFor(settings, date, timeZone))
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
  dimmed: { dark: 0.55, light: 0.4 },
} as const

export type PhotoTheme = 'light' | 'dark'

// Each image comes 1920 and 3840 px wide, and 400 for the pickers (design/backgrounds/README.md). `cover` stretches it to
// the larger of the viewport's width and its height's 16:9 width, times the pixel ratio (at most
// 2); past 2400 device pixels the large file is sharper. Screens under 768 px always get the small
// one.
export const PHOTO_SMALL = 1920
const PHOTO_LARGE = 3840
export const PHOTO_THUMB = 400

// Whether a theme switch may come soon, from the theme controls being opened or about to be: the
// scene then loads the other theme's picture, so a switch crossfades. Until then only the shown
// theme's loads, and a switch fades the new picture in once it has decoded.
const [themeSwitchLikely, setThemeSwitchLikely] = createSignal(false)
export { themeSwitchLikely }

export function expectThemeSwitch() {
  setThemeSwitchLikely(true)
}

export function photoWidth(viewport: { width: number; height: number; dpr: number }) {
  if (viewport.width < 768) return PHOTO_SMALL
  const needed =
    Math.max(viewport.width, (viewport.height * 16) / 9) * Math.min(viewport.dpr || 1, 2)
  return needed > PHOTO_SMALL * 1.25 ? PHOTO_LARGE : PHOTO_SMALL
}

// public/ files are cached for a week, so a replaced image needs a new file name: its version,
// raised by one for both themes. An id left out is version 2.
const PHOTO_VERSIONS: Partial<Record<ImageId, number>> = {
  winter: 1,
  spring: 1,
  summer: 1,
  autumn: 1,
  'coast-january': 1,
  'coast-june': 1,
  'land-january': 1,
  'land-february': 1,
  'land-august': 1,
}

// Each collection's files are in a folder of its own, public/backgrounds/<collection>/. They're
// AVIF only: every supported browser decodes it (docs/architecture/platform.md, "Supported
// browsers"). One that doesn't fails the load, which leaves the page color behind the scene.
export function photoUrl(id: ImageId, theme: PhotoTheme, width: number) {
  const version = String(PHOTO_VERSIONS[id] ?? 2).padStart(2, '0')
  return `/backgrounds/${imageCollection(id)}/${id}-${theme}-${version}-${width}.avif`
}

// The pickers' image: a 400 px file, since a picker shows up to 28 at a time.
export function thumbUrl(id: ImageId, theme: PhotoTheme) {
  return photoUrl(id, theme, PHOTO_THUMB)
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

// The data attributes a frame with the scene carries, from which src/styles.css styles its
// surfaces, header, and page text, and the tint's strength, which the scene and the glass share.
export function sceneAttributes(
  settings: Pick<SceneSettings, 'sceneBackground' | 'surfaces' | 'sceneStrength'>,
) {
  return {
    'data-scene-bg': settings.sceneBackground ? 'on' : 'off',
    'data-surfaces': settings.surfaces,
    style: {
      '--scene-tint-light': String(STRENGTHS[settings.sceneStrength].light),
      '--scene-tint-dark': String(STRENGTHS[settings.sceneStrength].dark),
    },
  } as const
}
