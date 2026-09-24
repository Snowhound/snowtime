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
import { Suspense } from 'solid-js'

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
      setLocale(session.settings.locale)
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
  const theme = () => session.data?.settings?.theme ?? 'system'

  return (
    <html lang={getLocale()} data-theme={theme()}>
      <head>
        <script innerHTML={themeScript} />
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <Suspense>
          <Outlet />
          <TanStackRouterDevtools />
        </Suspense>
        <Scripts />
      </body>
    </html>
  )
}
