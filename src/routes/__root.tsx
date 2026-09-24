import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
} from '@tanstack/solid-router'
import type { QueryClient } from '@tanstack/solid-query'
import { useQuery } from '@tanstack/solid-query'

import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'

import '@fontsource/inter/400.css'

import { HydrationScript, isServer } from 'solid-js/web'
import { Show, Suspense, createMemo } from 'solid-js'

import styleCss from '../styles.css?url'
import { getLocale, setLocale } from '../paraglide/runtime.js'
import { sessionQuery, themeScript } from '../lib/session'

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
    links: [{ rel: 'stylesheet', href: styleCss }],
  }),
  shellComponent: RootComponent,
})

function RootComponent() {
  const session = useQuery(() => sessionQuery)
  function theme() {
    return session.data?.settings?.theme ?? 'system'
  }

  // Saving another language switches it in place: Paraglide takes the new locale and sets
  // the cookie for later requests, and the page renders again, since messages are plain
  // functions that Solid doesn't track. The first render already has the right locale.
  const locale = createMemo(() => {
    const saved = session.data?.settings?.locale
    if (!isServer && saved && saved !== getLocale()) void setLocale(saved, { reload: false })
    return getLocale()
  })

  return (
    <html lang={locale()} data-theme={theme()}>
      <head>
        {/* oxlint-disable-next-line solid/no-innerhtml -- themeScript is a constant. */}
        <script innerHTML={themeScript} />
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <Suspense>
          <Show when={locale()} keyed>
            <Outlet />
          </Show>
          <TanStackRouterDevtools />
        </Suspense>
        <Scripts />
      </body>
    </html>
  )
}
