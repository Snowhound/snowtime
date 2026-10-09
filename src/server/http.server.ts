// The JSON API's shared steps (task 089): the checks every route passes, a route's input,
// and how a rule's result or refusal becomes the answer. api.server.ts mounts each domain's
// routes (<domain>.routes.ts) behind them; a route's handler only calls its rule.
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { matchedRoutes } from 'hono/route'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import * as v from 'valibot'
import { type Database, db } from '~/db'
import { withActor } from '~/db/actor'
import { appUrl, trustedOrigins } from '~/env'
import { decode, type WireError } from '~/lib/api/wire'
import { ApiKeyRefusal, bearerKey } from './auth/api-keys.server'
import { authRefusal, keyUser, signedInUser } from './auth/auth.server'
import { databaseAvailable } from './availability/availability.server'
import { AppError, type AppErrorCode } from './errors'
import { resolveScope, type Scope } from './scope.server'

// What the routes behind signedIn() and organization() know about the caller.
export interface UserEnv {
  Variables: { userId: string }
}
export interface OrganizationEnv {
  Variables: { userId: string; scope: Scope }
}

function failure(c: Context, status: number, error: WireError) {
  return c.json({ error }, status as ContentfulStatusCode)
}

// Marks a POST that only reads, such as a report's, whose filters travel as a JSON body: it
// passes the checks a GET does.
export const reads = createMiddleware((_, next) => next())

// Marks a route a personal API key may call (docs/api.md). Every other route refuses a key.
export const keys = createMiddleware((_, next) => next())

function marked(c: Context, marker: unknown) {
  return matchedRoutes(c).some((route) => route.handler === marker)
}

// A GET reads, and so does a route marked `reads`; every other route writes.
function writes(c: Context) {
  return c.req.method !== 'GET' && !marked(c, reads)
}

// A preview also accepts its deployment URL (src/lib/app-url.ts).
const appOrigins = new Set([new URL(appUrl).origin, ...trustedOrigins])

// First for every request: a path no route serves is unknown before any other check, a key
// reaches only the routes marked `keys`, and writes with the session cookie come only from
// the app's own pages. The public URL counts, not the request's own, since a proxy in front
// may change the host. Another site can't set a key's header, so a key's writes need no
// Origin.
export const known = createMiddleware(async (c, next) => {
  // Middleware matches any method and path; only a route names its method.
  if (!matchedRoutes(c).some((route) => route.method !== 'ALL')) {
    return failure(c, 404, { message: 'No such call.' })
  }
  const key = bearerKey(c.req.raw.headers)
  if (key && !marked(c, keys)) throw new ApiKeyRefusal('api_key_not_allowed')
  if (writes(c) && !key && !appOrigins.has(c.req.header('origin') ?? '')) {
    return failure(c, 403, { message: 'Cross-origin request refused.' })
  }
  return next()
})

// The signed-in user, with a write counted against their rate. The rest of the request runs
// as them (withActor). A key alone signs its request in: the session cookie is never read, so
// a session can't widen what the key may do.
export const signedIn = createMiddleware<UserEnv>(async (c, next) => {
  const key = bearerKey(c.req.raw.headers)
  if (!key) {
    const userId = await signedInUser(c.req.raw.headers, writes(c))
    c.set('userId', userId)
    await withActor(userId, next)
    return
  }
  const { userId, lastUse } = await keyUser(key, writes(c))
  c.set('userId', userId)
  await withActor(userId, next)
  await lastUse
})

// The tenancy scope of the organization in the path ("Tenancy" in docs/architecture/data.md).
// It is resolved before the route's own input is checked.
export const organization = createMiddleware<OrganizationEnv>(async (c, next) => {
  c.set('scope', await resolveScope(db, c.var.userId, c.req.param('organizationId')!))
  await next()
})

// The route's input: its path parameters over the query string of a GET or the JSON body of
// any other method, decoded and validated against the schema.
export function input<S extends v.GenericSchema>(schema: S) {
  return createMiddleware<{ Variables: { input: v.InferOutput<S> } }>(async (c, next) => {
    let fields: unknown
    if (c.req.method === 'GET') {
      fields = Object.fromEntries(new URL(c.req.url).searchParams)
    } else {
      const text = await c.req.text()
      try {
        fields = text ? JSON.parse(text) : {}
      } catch {
        return failure(c, 400, { message: 'The body is not JSON.' })
      }
    }
    c.set('input', decode(schema, { ...(fields as object), ...c.req.param() }))
    return next()
  })
}

// What run() reads of a route's context: Hono's Context type differs with each route's
// variables and path, so it is matched by shape.
interface RouteContext<V> {
  var: V
  json: (object: unknown) => Response
}

// Runs the route's rule for the caller, the organization's scope or the signed-in user, with
// the route's input. A rule without input leaves it off.
export function run<I, O>(
  c: RouteContext<{ scope: Scope; input?: I }>,
  rule: (db: Database, scope: Scope, input: I) => Promise<O>,
): Promise<Response>
export function run<I, O>(
  c: RouteContext<{ userId: string; input?: I }>,
  rule: (db: Database, userId: string, input: I) => Promise<O>,
): Promise<Response>
export async function run(
  c: RouteContext<{ userId?: string; scope?: Scope; input?: unknown }>,
  // oxlint-disable-next-line typescript/no-explicit-any -- each overload types its rule
  rule: (db: Database, actor: any, input: any) => Promise<unknown>,
) {
  return c.json(await rule(db, c.var.scope ?? c.var.userId, c.var.input))
}

const statusOf: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID: 422,
  LIMIT_REACHED: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
}

// A refusal's status and body: an AppError's code and key, input that fails its schema, a
// key's refusal, or Better Auth's refusal. Null for anything unexpected.
function refusalOf(error: unknown): { status: number; error: WireError } | null {
  if (error instanceof AppError) {
    return { status: statusOf[error.code], error: { code: error.code, key: error.key } }
  }
  if (error instanceof v.ValiError) return { status: 400, error: { message: error.message } }
  if (error instanceof ApiKeyRefusal) {
    return { status: error.status, error: { code: error.code, message: error.message } }
  }
  return authRefusal(error)
}

// An unexpected error while the database is unreachable is UNAVAILABLE.
async function unavailableOr(error: unknown) {
  if (error instanceof Error && !(error instanceof AppError) && !(await databaseAvailable(db))) {
    return new AppError('UNAVAILABLE', 'database_unavailable')
  }
  return error
}

// The API's error handler. Any other error propagates, and Start answers it with a 500.
export async function refused(error: Error, c: Context) {
  const refusal = refusalOf(error) ?? refusalOf(await unavailableOr(error))
  if (!refusal) throw error
  return failure(c, refusal.status, refusal.error)
}
