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
import { SCENE_DEFAULTS, type SceneSettings } from './scene'

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
