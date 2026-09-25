import { useQuery } from '@tanstack/solid-query'
import type { JSX } from 'solid-js'
import { Show, onMount } from 'solid-js'
import { AppMark } from '~/components/app-mark'
import { Intro, IntroPage } from '~/components/intro'
import { SceneLayer } from '~/components/scene-layer'
import { SeasonTagline } from '~/components/season-tagline'
import { Separator } from '~/components/ui/separator'
import { appIcon } from '~/lib/app-icon'
import {
  DEVICE_DEFAULTS,
  type DeviceSettings,
  deviceSettings,
  loadDeviceSettings,
  updateDeviceSettings,
} from '~/lib/device-settings'
import { introDue, introScene, playIntro, releaseIntroPending } from '~/lib/intro'
import { currentSeason, sceneAttributes } from '~/lib/scene'
import { sessionQuery } from '~/lib/session'
import { useUpdateSettings } from '~/lib/settings'
import { m } from '~/paraglide/messages.js'
import { AppearanceMenu } from './appearance-menu'

// The signed-out screens' frame: a centered card over the seasonal scene, with the product
// mark and the season's tagline above it (prototypes/auth.html, 01 · Card), and the Appearance menu at the top
// right. Signed out, the settings are the device's (src/lib/device-settings.ts); they load after
// hydration, so the first paint shows the defaults. A signed-in user without an organization
// yet has the account's.
export function AuthLayout(props: { children: JSX.Element; firstVisitIntro?: boolean }) {
  const session = useQuery(() => sessionQuery)
  const save = useUpdateSettings()
  function settings(): DeviceSettings {
    return session.data?.settings ?? deviceSettings() ?? DEVICE_DEFAULTS
  }
  // While the intro plays, the scene follows it.
  function shown() {
    return introScene(settings())
  }
  function update(patch: Partial<DeviceSettings>) {
    if (session.data?.settings) save.mutate(patch)
    else updateDeviceSettings(patch)
  }

  // The intro plays on the sign-in page on the first visit to this browser. The device's
  // settings load here too, since the root loads them only after its children mount.
  onMount(() => {
    loadDeviceSettings()
    if (props.firstVisitIntro && introDue('sign-in', settings().sceneIntro)) {
      playIntro({ season: currentSeason(settings().sceneSeason), signedIn: !!session.data })
    } else releaseIntroPending()
  })

  return (
    <div class="isolate" {...sceneAttributes(shown())}>
      <SceneLayer settings={shown()} pace="full" />
      <IntroPage>
        <main class="relative flex min-h-dvh flex-col items-center justify-start gap-6 px-4 pt-32 pb-10 sm:justify-center sm:py-16">
          <AppearanceMenu
            settings={settings()}
            onDevice={!session.data?.settings}
            onChange={update}
          />
          {/* The tagline sits 32 px above the card, out of the flow, so the card stays centered;
              on phones the page's top padding makes room for it. */}
          <div class="relative w-full max-w-sm">
            <SeasonTagline
              season={currentSeason(settings().sceneSeason)}
              class="absolute bottom-[calc(100%+2rem)] left-1/2 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 text-center text-base font-medium text-balance"
            />
            <div class="surface auth-card bg-card text-card-foreground flex w-full flex-col gap-6 rounded-lg border p-6 shadow-sm sm:p-8">
              <div class="flex items-center gap-2 text-base font-bold tracking-[-0.02em]">
                <AppMark id={appIcon(settings().appIcon).id} small class="size-7" />
                {m.app_name()}
              </div>
              <div class="flex flex-col gap-6">{props.children}</div>
            </div>
          </div>
        </main>
      </IntroPage>
      <Intro />
    </div>
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
