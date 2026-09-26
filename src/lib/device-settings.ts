import { type Accessor, createEffect, createMemo, createSignal, on } from 'solid-js'
// The settings signed-out pages use, kept in this browser's localStorage (prototypes/auth.html):
// the theme, the app icon, and the scene. Signed in, the account's settings apply, and the root
// copies them here, so the sign-in page opens as the last user left it. Changes on a signed-out
// page stay on the device. Storage can be missing or blocked, so every access is guarded.
import * as v from 'valibot'
import {
  AppIcon,
  SceneSeason,
  SceneStrength,
  Surfaces,
  Theme,
  type THEMES,
} from '~/server/settings/settings.schemas'
import { type AppIconId, DEFAULT_APP_ICON } from './app-icon'
import { APP_PAGES } from './app-paths'
import { INTRO_PENDING_TIMEOUT, INTRO_SEASON_KEY, INTRO_SEEN_KEY } from './scene/intro'
import { SCENE_DEFAULTS, type SceneSettings, seasonByMonth } from './scene/scene'

export const DEVICE_SETTINGS_KEY = 'snowtime.settings'

export type DeviceSettings = SceneSettings & {
  theme: (typeof THEMES)[number]
  appIcon: AppIconId
}

export const DEVICE_DEFAULTS: DeviceSettings = {
  theme: 'system',
  appIcon: DEFAULT_APP_ICON,
  ...SCENE_DEFAULTS,
}

const DEVICE_SETTING_KEYS = Object.keys(DEVICE_DEFAULTS) as (keyof DeviceSettings)[]

export function sameDeviceSettings(a: DeviceSettings | null, b: DeviceSettings | null) {
  if (!a || !b) return a === b
  return DEVICE_SETTING_KEYS.every((key) => a[key] === b[key])
}

const FIELDS: { [K in keyof DeviceSettings]: v.GenericSchema<unknown, DeviceSettings[K]> } = {
  theme: Theme,
  appIcon: AppIcon,
  sceneSeason: SceneSeason,
  sceneBackground: v.boolean(),
  sceneStrength: SceneStrength,
  surfaces: Surfaces,
  sceneWeather: v.boolean(),
  sceneIntro: v.boolean(),
}

// The stored JSON, with each missing or invalid field at its default.
export function parseDeviceSettings(json: string | null): DeviceSettings {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(json ?? '{}')
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>
  } catch {
    // Not JSON: every field falls back.
  }
  const settings = { ...DEVICE_DEFAULTS }
  for (const key of Object.keys(FIELDS) as (keyof DeviceSettings)[]) {
    const result = v.safeParse(FIELDS[key], stored[key])
    if (result.success) Object.assign(settings, { [key]: result.output })
  }
  return settings
}

function read() {
  try {
    return parseDeviceSettings(localStorage.getItem(DEVICE_SETTINGS_KEY))
  } catch {
    return { ...DEVICE_DEFAULTS }
  }
}

// Null on the server and until the root loads them after hydration, since only the browser has
// them.
const [deviceSettings, setDeviceSettingsSignal] = createSignal<DeviceSettings | null>(null)
export { deviceSettings }

let loaded = false

// Loads the stored settings and follows changes from other tabs. The root calls it on mount.
export function loadDeviceSettings() {
  setDeviceSettingsSignal(read())
  if (loaded) return
  loaded = true
  window.addEventListener('storage', (event) => {
    if (event.key === DEVICE_SETTINGS_KEY || event.key === null) setDeviceSettingsSignal(read())
  })
}

export function updateDeviceSettings(patch: Partial<DeviceSettings>) {
  const next = { ...(deviceSettings() ?? read()), ...patch }
  setDeviceSettingsSignal(next)
  try {
    localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Storage is blocked: the change holds until the page reloads.
  }
}

// Signed-in settings become the device's starting point for the next sign-in page. Only copy
// when their values change: a session refetch returns a fresh object, and copying that object
// again would undo a choice made in a signed-out tab.
export function followAccountDeviceSettings(account: Accessor<DeviceSettings | null | undefined>) {
  const loaded = createMemo(() => !!deviceSettings())
  const accountCopy = createMemo(
    () => {
      const settings = account()
      if (!settings) return null
      return {
        theme: settings.theme,
        appIcon: settings.appIcon,
        sceneSeason: settings.sceneSeason,
        sceneBackground: settings.sceneBackground,
        sceneStrength: settings.sceneStrength,
        surfaces: settings.surfaces,
        sceneWeather: settings.sceneWeather,
        sceneIntro: settings.sceneIntro,
      }
    },
    null,
    { equals: sameDeviceSettings },
  )
  createEffect(
    on([accountCopy, loaded], ([copy, ready]) => {
      if (!copy || !ready) return
      if (!sameDeviceSettings(copy, deviceSettings())) updateDeviceSettings(copy)
    }),
  )
}

// The season of each month, for the head script.
const MONTH_SEASONS = Array.from({ length: 12 }, (_, month) => seasonByMonth(new Date(2000, month)))

// The signed-in pages, /<slug>/<page>, where the intro plays once a season (src/routes/$org/).
const APP_PATHS = new RegExp(`^/[^/]+/(${APP_PAGES.join('|')})(/|$)`)

// Runs in <head> before the body paints. Signed in, the server renders the theme setting as
// data-theme on <html>; signed out it renders none, and the theme saved on this device applies
// until the root sets data-theme from it after hydration. This applies the `dark` class,
// resolving "system" with the browser's preference, and follows later changes to either.
//
// When the intro is due on this page by the device's settings (src/lib/scene/intro.ts), it marks
// <html data-intro="pending">, which paints the page black until the intro starts; the frame
// clears it if the account's settings say otherwise, and a timeout clears it if nothing mounts.
// While <html> has data-intro, the page is dark.
export const themeScript = `(() => {
  const root = document.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  let stored = {}
  try {
    stored = JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_SETTINGS_KEY)}) ?? '{}') ?? {}
  } catch {}
  try {
    const path = location.pathname
    const where = path === '/sign-in' ? 'sign-in' : ${APP_PATHS}.test(path) ? 'app' : null
    const due =
      where &&
      stored.sceneIntro !== false &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      (where === 'app'
        ? localStorage.getItem(${JSON.stringify(INTRO_SEASON_KEY)}) !== ${JSON.stringify(MONTH_SEASONS)}[new Date().getMonth()]
        : localStorage.getItem(${JSON.stringify(INTRO_SEEN_KEY)}) !== '1')
    if (due) {
      root.dataset.intro = 'pending'
      setTimeout(() => root.dataset.intro === 'pending' && delete root.dataset.intro, ${INTRO_PENDING_TIMEOUT})
    }
  } catch {}
  const theme = () => root.dataset.theme ?? stored.theme
  const apply = () =>
    root.classList.toggle('dark', root.dataset.intro !== undefined || theme() === 'dark' || (theme() !== 'light' && dark.matches))
  apply()
  dark.addEventListener('change', apply)
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-intro'] })
})()`
