import { createFileRoute } from '@tanstack/solid-router'
import { handleApiRequest } from '~/server/api.server'

// The JSON API (task 084). Start passes methods it has no handler key for, such as QUERY,
// only to ANY.
export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      ANY: ({ request }) => handleApiRequest(request),
    },
  },
})
