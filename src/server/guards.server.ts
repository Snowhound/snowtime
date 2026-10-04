// Checks every call of the JSON API runs through (api.server.ts), over HTTP or in a
// server render.
import { db } from '~/db'
import { env } from '~/env'
import { keyChecker } from './auth/api-keys.server'
import { auth, rateLimitStore, sessionOf } from './auth/better-auth.server'
import { databaseAvailable } from './availability/availability.server'
import { AppError } from './errors'
import { rateLimits } from './limits.server'
import { time } from './timing.server'

// The error to throw for `error`: UNAVAILABLE when it was unexpected and the database is
// unreachable, else the error itself.
export async function unavailableOr(error: unknown) {
  if (error instanceof Error && !(error instanceof AppError) && !(await databaseAvailable(db))) {
    return new AppError('UNAVAILABLE', 'database_unavailable')
  }
  return error
}

// The signed-in user of a request, counting a write against their rate.
export async function signedInUser(headers: Headers, write: boolean) {
  const session = await sessionOf(headers)
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'sign_in_required')
  }
  const { userId } = session.session
  if (write) {
    const { allowed } = await rateLimitStore.consume(`write:${userId}`, rateLimits.writesPerUser)
    if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
  }
  return userId
}

// The user of a request's API key (docs/architecture/auth.md, "API keys").
export const keyUser = keyChecker({
  db,
  // Timed as `session`, since it stands in for the session lookup.
  verifyKey: (key) => time('session', () => auth.api.verifyApiKey({ body: { key } })),
  rateLimitStore,
  loginDomains: env.ALLOWED_LOGIN_DOMAINS ?? [],
})
