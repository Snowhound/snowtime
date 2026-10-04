// What the rest of the server needs from Better Auth, so that only this folder imports it:
// the request's session, and Better Auth's refusals as the API sends them.
import { APIError } from 'better-auth/api'
import type { WireError } from '~/lib/api/wire'
import { AppError } from '../errors'
import { rateLimits } from '../limits.server'
import { rateLimitStore, sessionOf } from './better-auth.server'

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

// Better Auth's own refusal, as its HTTP API sends it, or null for any other error.
export function authRefusal(error: unknown): { status: number; error: WireError } | null {
  if (!(error instanceof APIError)) return null
  return { status: error.statusCode, error: { code: error.body?.code, message: error.message } }
}
