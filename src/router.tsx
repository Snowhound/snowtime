import { createRouter as createTanStackRouter } from '@tanstack/solid-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/solid-router-ssr-query'
import { getGlobalStartContext } from '@tanstack/solid-start'
import { getContext } from '~/integrations/tanstack-query/provider'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,

    context,

    // The page's CSP nonce (src/server-entry.ts), which the router and Solid put on the
    // scripts they render. The client reads it back from the page's csp-nonce meta tag.
    // Start types the context as never without a registered start config.
    ssr: { nonce: (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce },

    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  // Provides the query client to components and hands queries loaded on the server to the
  // client, so it doesn't fetch them again.
  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/solid-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
  interface StaticDataRouteOption {
    // The page's content may be wider than the header (AppFrame).
    wide?: boolean
  }
}
