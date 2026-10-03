// The checks every /api/v1 route goes through (docs/api.md). A route wraps its handler with
// apiRoute, which signs the request in with an API key, applies the key's scope and the
// user's rates, resolves the organization, validates the input, and turns errors into the
// documented JSON body.
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import type { Database } from '~/db'
import { withActor } from '~/db/actor'
import { user } from '~/db/schema'
import { loginDomainAllowed } from '~/lib/login-domains'
import type { ApiKeyAccess } from '../auth/auth.schemas'
import { databaseAvailable } from '../availability/availability.server'
import { AppError, type AppErrorCode, type AppErrorKey, errorMessages } from '../errors'
import { rateLimits } from '../limits.server'
import type { RateLimitStore } from '../rate-limit.server'
import { resolveScope, type Scope } from '../scope.server'

// What the api-key plugin's verifyApiKey answers, as far as the checks read it.
type VerifiedKey = {
  valid: boolean
  error: { code?: string; details?: { tryAgainIn?: number } } | null
  key: { referenceId: string; permissions?: Record<string, string[]> | null } | null
}

export type ApiDeps = {
  db: Database
  // auth.api.verifyApiKey without permissions, so a key that lacks the route's scope is
  // told apart from an unknown one (task 082, README point 5).
  verifyKey: (key: string) => Promise<VerifiedKey>
  rateLimitStore: RateLimitStore
  loginDomains: readonly string[]
}

type RouteOptions = {
  access: ApiKeyAccess
  // A route under /api/v1/orgs/$orgId/ acts in that organization, as context.scope.
  organization?: boolean
  // Checks the query parameters of a GET, or the JSON body of anything else.
  input?: v.GenericSchema
}

type RouteContext<O extends RouteOptions> = {
  request: Request
  params: Record<string, string>
  userId: string
  input: O['input'] extends v.GenericSchema ? v.InferOutput<O['input']> : undefined
} & (O['organization'] extends true ? { scope: Scope } : unknown)

// Start's server route handlers take this.
type RouteArgs = { request: Request; params: Record<string, string> }

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

// Responses hold one user's data, so nothing between the client and the server may keep
// them. No CORS headers: browsers on other origins can't call the API.
function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

function failure(code: AppErrorCode | 'INTERNAL', message: string, retryAfter?: number) {
  const status = code === 'INTERNAL' ? 500 : statusOf[code]
  const headers: Record<string, string> = retryAfter ? { 'retry-after': String(retryAfter) } : {}
  return json(status, { error: { code, message } }, headers)
}

function refuse(code: AppErrorCode, key: AppErrorKey, retryAfter?: number) {
  return failure(code, errorMessages[key], retryAfter)
}

function bearerKey(request: Request) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

async function rawInput(request: Request): Promise<{ value: unknown } | null> {
  if (request.method === 'GET') {
    return { value: Object.fromEntries(new URL(request.url).searchParams) }
  }
  const text = await request.text()
  if (text.trim() === '') return { value: {} }
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return null
  }
}

export function createApiRoute(deps: ApiDeps) {
  const { db } = deps

  // The key's user, or the response that refuses the request.
  async function signIn(request: Request, access: ApiKeyAccess) {
    const key = bearerKey(request)
    if (!key) return refuse('UNAUTHENTICATED', 'api_key_missing')

    const verified = await deps.verifyKey(key)
    if (!verified.valid || !verified.key) {
      const code = verified.error?.code
      if (code === 'RATE_LIMITED') {
        const ms = verified.error?.details?.tryAgainIn ?? 1000
        return refuse('RATE_LIMITED', 'api_rate_limited', Math.max(1, Math.ceil(ms / 1000)))
      }
      if (code === 'KEY_EXPIRED') return refuse('UNAUTHENTICATED', 'api_key_expired')
      // The plugin reports a failed database read as an invalid key, so a refusal while
      // the database is down would tell the client to replace a working key.
      if (!(await databaseAvailable(db))) return refuse('UNAVAILABLE', 'database_unavailable')
      return refuse('UNAUTHENTICATED', 'api_key_invalid')
    }

    if (!verified.key.permissions?.api?.includes(access)) {
      return refuse('FORBIDDEN', 'api_key_read_only')
    }

    const userId = verified.key.referenceId
    const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
    if (!owner) return refuse('UNAUTHENTICATED', 'api_key_invalid')
    // The login-domain policy applies to keys as it does to sessions, so a key outlives
    // neither a domain's removal from ALLOWED_LOGIN_DOMAINS nor a changed address.
    if (!loginDomainAllowed(owner.email, deps.loginDomains)) {
      return refuse('UNAUTHENTICATED', 'login_domain_not_allowed')
    }

    // The same count as sessionMiddleware's, so a user's writes share one rate whether
    // they come from the web app or a key.
    if (access === 'write') {
      const { allowed, retryAfter } = await deps.rateLimitStore.consume(
        `write:${userId}`,
        rateLimits.writesPerUser,
      )
      if (!allowed) return refuse('RATE_LIMITED', 'rate_limited', retryAfter ?? undefined)
    }
    return userId
  }

  async function run<O extends RouteOptions>(
    options: O,
    handler: (context: RouteContext<O>) => Promise<unknown>,
    { request, params }: RouteArgs,
  ): Promise<Response> {
    const userId = await signIn(request, options.access)
    if (userId instanceof Response) return userId

    let input: unknown
    if (options.input) {
      const raw = await rawInput(request)
      if (!raw) return failure('INVALID', 'Body is not valid JSON.')
      const parsed = v.safeParse(options.input, raw.value)
      if (!parsed.success) return failure('INVALID', parsed.issues[0].message)
      input = parsed.output
    }

    const scope = options.organization ? await resolveScope(db, userId, params.orgId) : undefined
    const context = { request, params, userId, input, scope } as RouteContext<O>
    const result = await withActor(userId, () => handler(context))
    return result instanceof Response ? result : json(200, result)
  }

  return function apiRoute<O extends RouteOptions>(
    options: O,
    handler: (context: RouteContext<O>) => Promise<unknown>,
  ) {
    return async (args: RouteArgs): Promise<Response> => {
      try {
        return await run(options, handler, args)
      } catch (error) {
        if (error instanceof AppError) return failure(error.code, error.message)
        console.error(error)
        if (!(await databaseAvailable(db))) return refuse('UNAVAILABLE', 'database_unavailable')
        return failure('INTERNAL', 'Something went wrong.')
      }
    }
  }
}
