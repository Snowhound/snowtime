import { QueryClient } from '@tanstack/solid-query'
import { createRouter as createTanStackRouter } from '@tanstack/solid-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/solid-router-ssr-query'
import { getGlobalStartContext } from '@tanstack/solid-start'
import { isServer } from 'solid-js/web'
import { ErrorPage } from '~/features/errors/error-page'
import { NotFoundPage } from '~/features/errors/not-found-page'
import { readRetryDelay } from '~/lib/queries/refusal'
import { followSession } from '~/lib/queries/session'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        // Data rendered on the server is fresh when the page hydrates; without this the
        // client refetches everything right away.
        staleTime: 30_000,
        // A server render answers at once with what it has, as query-core's own default
        // does there; the browser retries, waiting at least a refusal's Retry-After.
        retry: isServer ? 0 : 3,
        retryDelay: readRetryDelay,
      },
    },
  })
  followSession(queryClient)

  const router = createTanStackRouter({
    routeTree,

    context: { queryClient },

    // The page's CSP nonce (src/server-entry.ts), which the router and Solid put on the
    // scripts they render. The client reads it back from the page's csp-nonce meta tag.
    ssr: { nonce: getGlobalStartContext()?.nonce },

    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,

    // A route whose loader waits on the server shows its pendingComponent after 100 ms, so
    // a link opens at once rather than holding the previous page; once shown, it stays
    // 300 ms, so it doesn't flash. Loaders that read the cache finish before either.
    defaultPendingMs: 100,
    defaultPendingMinMs: 300,

    // What a route shows in place of its page when it throws, while loading or rendering,
    // or when it throws notFound() or the path matches no route. Every route needs its own:
    // the server renders a route's error with that route's component, not a parent's.
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  })

  // Provides the query client to components and hands queries loaded on the server to the
  // client, so it doesn't fetch them again.
  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/solid-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
    // What src/server-entry.ts passes each request.
    server: { requestContext: { nonce: string; cookie: string } }
  }
  interface StaticDataRouteOption {
    // The page's content may be wider than the header (AppFrame).
    wide?: boolean
  }
}
