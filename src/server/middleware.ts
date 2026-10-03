import { createMiddleware } from '@tanstack/solid-start'
import { unavailableOr } from './guards.server'

// Runs around every server function (src/start.ts). An unexpected error while the database is
// unreachable, such as during a migration window, becomes an UNAVAILABLE AppError, so the page
// shows the maintenance page rather than a generic error. Only unexpected errors pay for the
// probe.
export const availabilityMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    try {
      return await next()
    } catch (error) {
      throw await unavailableOr(error)
    }
  },
)
