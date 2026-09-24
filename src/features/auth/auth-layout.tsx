import { useQuery } from '@tanstack/solid-query'
import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { AppMark } from '~/components/app-mark'
import { SceneLayer } from '~/components/scene-layer'
import { Separator } from '~/components/ui/separator'
import { appIcon } from '~/lib/app-icon'
import {
  DEVICE_DEFAULTS,
  type DeviceSettings,
  deviceSettings,
  updateDeviceSettings,
} from '~/lib/device-settings'
import { sceneAttributes } from '~/lib/scene'
import { sessionQuery } from '~/lib/session'
import { useUpdateSettings } from '~/lib/settings'
import { m } from '~/paraglide/messages.js'
import { AppearanceMenu } from './appearance-menu'

// The signed-out screens' frame: a centered card over the seasonal scene, with the product
// mark and the tagline (prototypes/auth.html, 01 · Card), and the Appearance menu at the top
// right. Signed out, the settings are the device's (src/lib/device-settings.ts); they load after
// hydration, so the first paint shows the defaults. A signed-in user without an organization
// yet has the account's.
export function AuthLayout(props: { children: JSX.Element }) {
  const session = useQuery(() => sessionQuery)
  const save = useUpdateSettings()
  function settings(): DeviceSettings {
    return session.data?.settings ?? deviceSettings() ?? DEVICE_DEFAULTS
  }
  function update(patch: Partial<DeviceSettings>) {
    if (session.data?.settings) save.mutate(patch)
    else updateDeviceSettings(patch)
  }

  return (
    <main
      class="relative isolate flex min-h-dvh flex-col items-center justify-start gap-6 px-4 pt-16 pb-10 sm:justify-center sm:py-16"
      {...sceneAttributes(settings())}
    >
      <SceneLayer settings={settings()} />
      <AppearanceMenu settings={settings()} onDevice={!session.data?.settings} onChange={update} />
      <div class="surface auth-card bg-card text-card-foreground flex w-full max-w-sm flex-col gap-6 rounded-lg border p-6 shadow-sm sm:p-8">
        <div class="flex items-center gap-2 text-base font-bold tracking-[-0.02em]">
          <AppMark id={appIcon(settings().appIcon).id} small class="size-7" />
          {m.app_name()}
        </div>
        <div class="flex flex-col gap-6">{props.children}</div>
      </div>
      <p class="scene-text text-muted-foreground text-center text-sm">{m.auth_tagline()}</p>
    </main>
  )
}

export function AuthHeading(props: { title: string; description?: string }) {
  return (
    <div class="flex flex-col gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">{props.title}</h1>
      <Show when={props.description}>
        <p class="text-muted-foreground text-sm">{props.description}</p>
      </Show>
    </div>
  )
}

// The round badge above a status screen's heading (expired, wrong account).
export function AuthIcon(props: { children: JSX.Element }) {
  return (
    <div class="bg-muted flex size-12 items-center justify-center rounded-full [&_svg]:size-6">
      {props.children}
    </div>
  )
}

export function AuthDivider() {
  return (
    <div class="text-muted-foreground flex items-center gap-3 text-xs uppercase">
      <Separator class="flex-1" />
      <span>{m.auth_or()}</span>
      <Separator class="flex-1" />
    </div>
  )
}
