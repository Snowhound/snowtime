import { createFileRoute } from '@tanstack/solid-router'
import { v1 } from '~/server/api/v1.server'

export const Route = createFileRoute('/api/v1/orgs/$orgId/timer')({
  server: { handlers: { POST: v1.startTimer } },
})
