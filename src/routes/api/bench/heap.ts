import { createFileRoute } from '@tanstack/solid-router'
import { env } from '~/env'

// The app's memory, for the load benchmark's sampler (perf/stress/sampler). Only a bench
// deployment sets BENCH_HEAP, and its Caddy refuses the path from outside.
export const Route = createFileRoute('/api/bench/heap')({
  server: {
    handlers: {
      GET: () =>
        env.BENCH_HEAP ? Response.json(process.memoryUsage()) : new Response(null, { status: 404 }),
    },
  },
})
