import { createFileRoute } from '@tanstack/solid-router'
import { auth } from '~/server/auth/better-auth.server'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
