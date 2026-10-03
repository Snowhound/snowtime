import { createMiddleware } from '@tanstack/solid-start'
import { getRequest, getRequestHeaders } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { signedInUser, unavailableOr } from './guards.server'
import { parseOrganizationInput } from './schemas'
import { type Scope, resolveScope } from './scope.server'

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

// A signed-in user, as context.userId. The call runs as that user (withActor), and each POST
// counts against their write rate.
export const sessionMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next, method }) => {
    const userId = await signedInUser(getRequestHeaders(), method === 'POST')
    return withActor(userId, () => next({ context: { userId } }))
  },
)

// Scopes resolved during one request. A page rendered on the server calls its loaders' server
// functions in its own request, several at once, so they share one lookup; the promise is
// kept, so calls that run together wait on the same one.
const requestScopes = new WeakMap<Request, Map<string, Promise<Scope>>>()

function scopeOf(userId: string, organizationId: string) {
  const request = getRequest()
  let scopes = requestScopes.get(request)
  if (!scopes) {
    scopes = new Map()
    requestScopes.set(request, scopes)
  }
  const key = `${userId}:${organizationId}`
  let scope = scopes.get(key)
  if (!scope) {
    scope = resolveScope(db, userId, organizationId)
    scopes.set(key, scope)
  }
  return scope
}

// The scope of the organization the call names, as context.scope (docs/architecture/data.md,
// "Tenancy"). Start merges this validator's input type into the function's, so every scoped
// call must pass `organizationId`.
export const scopeMiddleware = createMiddleware({ type: 'function' })
  .middleware([sessionMiddleware])
  // Start runs this on the raw data before the function's own schema, which then parses the
  // rest, so it checks `organizationId` and returns the input whole. A Valibot looseObject
  // would do both, but its type fails Start's check that inputs are serializable.
  .validator((input: { organizationId: string }) => parseOrganizationInput(input))
  .server(async ({ next, context, data }) =>
    next({ context: { scope: await scopeOf(context.userId, data.organizationId) } }),
  )
