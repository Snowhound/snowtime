import { QueryClient } from '@tanstack/solid-query'
import { followSession } from '~/lib/session'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data rendered on the server is fresh when the page hydrates; without this the
        // client refetches everything right away.
        staleTime: 30_000,
      },
    },
  })
  followSession(queryClient)
  return {
    queryClient,
  }
}
