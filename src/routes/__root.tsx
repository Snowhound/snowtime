import fontLatin from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url'
import type { QueryClient } from '@tanstack/solid-query'
import { useQuery } from '@tanstack/solid-query'
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useRouter,
} from '@tanstack/solid-router'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'
import {
  For,
  type ParentProps,
  Show,
  Suspense,
  createEffect,
  createMemo,
  on,
  onMount,
} from 'solid-js'
import { HydrationScript, isServer } from 'solid-js/web'
import { appIcon, faviconLinks, setFavicon } from '~/lib/app-icon'
import {
  DEVICE_DEFAULTS,
  type DeviceSettings,
  deviceSettings,
  loadDeviceSettings,
  updateDeviceSettings,
} from '~/lib/device-settings'
import { sessionQuery, themeScript } from '~/lib/session'
import { getLocale, setLocale } from '~/paraglide/runtime.js'
import styleCss from '~/styles.css?url'
import '@fontsource-variable/plus-jakarta-sans'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    // The account's language differs from the one this page rendered in, and
    // getAppSession has set the cookie: load the page again in the account's language.
    if (session?.localeChanged && session.settings) {
      context.queryClient.removeQueries({ queryKey: sessionQuery.queryKey })
      if (isServer) throw redirect({ href: location.href })
      void setLocale(session.settings.locale)
    }
    return { session }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Snowtime' },
    ],
    links: [
      { rel: 'stylesheet', href: styleCss },
      // The stylesheet names the font, so without this it would load only once the CSS has.
      { rel: 'preload', href: fontLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
    ],
  }),
  shellComponent: RootComponent,
})

function RootComponent(props: ParentProps) {
  const router = useRouter()
  const session = useQuery(() => sessionQuery)
  // Signed out, the device's settings apply (src/lib/device-settings.ts). They load after
  // hydration; until then data-theme is unset and the head script applies the device's theme.
  onMount(loadDeviceSettings)
  function theme() {
    return session.data?.settings?.theme ?? deviceSettings()?.theme
  }

  // Signed in, the device keeps a copy of the account's theme, app icon, and scene, so the
  // sign-in page opens as the user left it.
  createEffect(() => {
    const settings = session.data?.settings
    const device = deviceSettings()
    if (!settings || !device) return
    const copy = Object.fromEntries(
      Object.keys(DEVICE_DEFAULTS).map((key) => [key, settings[key as keyof DeviceSettings]]),
    ) as DeviceSettings
    if (JSON.stringify(copy) !== JSON.stringify(device)) updateDeviceSettings(copy)
  })

  // Saving another language switches it in place: Paraglide takes the new locale and sets
  // the cookie for later requests, and the page renders again, since messages are plain
  // functions that Solid doesn't track. The first render already has the right locale.
  const locale = createMemo(() => {
    const saved = session.data?.settings?.locale
    if (!isServer && saved && saved !== getLocale()) void setLocale(saved, { reload: false })
    return getLocale()
  })

  // The user's app icon; signed out, the device's, or Hound Hour. The server renders its favicon links, and a
  // change replaces them (Solid doesn't hydrate <head>). Media queries pick Hound Hour's tile.
  function appIconId() {
    return appIcon(session.data?.settings?.appIcon ?? deviceSettings()?.appIcon).id
  }
  createEffect(on(appIconId, setFavicon, { defer: true }))

  return (
    <html lang={locale()} data-theme={theme()}>
      <head>
        {/* oxlint-disable-next-line solid/no-innerhtml -- themeScript is a constant. */}
        <script nonce={router.options.ssr?.nonce} innerHTML={themeScript} />
        <HydrationScript />
        <HeadContent />
        <For each={faviconLinks(appIconId())}>
          {(icon) => (
            <link
              rel="icon"
              type="image/png"
              sizes={icon.sizes}
              href={icon.href}
              media={icon.media}
            />
          )}
        </For>
      </head>
      <body>
        <Suspense>
          {/* The root's match, inside the error and not-found boundaries it has from the
              router's defaults (src/router.tsx). */}
          <Show when={locale()} keyed>
            {props.children}
          </Show>
          <TanStackRouterDevtools />
        </Suspense>
        <Scripts />
      </body>
    </html>
  )
}
