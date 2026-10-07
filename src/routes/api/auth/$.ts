import { createFileRoute } from '@tanstack/solid-router'
import { handleAuthRequest } from '~/server/auth/auth.server'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
