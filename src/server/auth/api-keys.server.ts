// Personal API keys: the api-key plugin's options, the rules Settings calls, and the check
// that signs a JSON API request in with a key. The plugin creates a key, because only it
// generates and hashes one; listing and revoking read and delete the plugin's rows directly
// (docs/architecture/auth.md, "API keys").
import type { apiKey } from '@better-auth/api-key'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '~/db'
import { apikey, user } from '~/db/schema'
import { loginDomainAllowed } from '~/lib/login-domains'
import { databaseAvailable } from '../availability/availability.server'
import { AppError, type AppErrorCode } from '../errors'
import { limits, rateLimits } from '../limits.server'
import type { RateLimitStore } from '../rate-limit.server'
import type { ApiKeyAccess, ApiKeyLifetime, CreateApiKeyInput } from './auth.schemas'

const DAY_SECONDS = 24 * 60 * 60

// Seconds, as the plugin's expiresIn takes them; null never expires.
const lifetimeSeconds: Record<ApiKeyLifetime, number | null> = {
  '30d': 30 * DAY_SECONDS,
  '90d': 90 * DAY_SECONDS,
  '1y': 365 * DAY_SECONDS,
  none: null,
}

// The plugin's permissions: one resource, with `write` implying `read`.
const permissionsFor: Record<ApiKeyAccess, { api: ApiKeyAccess[] }> = {
  read: { api: ['read'] },
  write: { api: ['read', 'write'] },
}

export const apiKeyOptions = {
  defaultPrefix: 'snow_',
  requireName: true,
  // The JSON API verifies a key itself (keyUser in guards.server.ts); with this on, the
  // plugin would turn a key into a session for /api/auth/* and every call too.
  enableSessionForAPIKeys: false,
  // The list names keys and shows no part of one.
  startingCharactersConfig: { shouldStore: false },
  // No default: the plugin applies one whenever expiresIn is empty, which would rule out a
  // key that never expires. Creation always passes the user's choice.
  keyExpiration: { defaultExpiresIn: null },
  rateLimit: {
    enabled: true,
    timeWindow: rateLimits.apiKeyRequests.window * 1000,
    maxRequests: rateLimits.apiKeyRequests.max,
  },
  // Deletes expired keys after the response instead of before it.
  deferUpdates: true,
} satisfies Parameters<typeof apiKey>[0]

// The plugin's HTTP endpoints, all closed (better-auth.server.ts, disabledPaths).
export const apiKeyDisabledPaths = [
  '/api-key/create',
  '/api-key/get',
  '/api-key/update',
  '/api-key/delete',
  '/api-key/list',
]

// The plugin's create call, as the API's handler binds it. Called without request
// headers, so the plugin accepts the server-only permissions.
export type IssueApiKey = (body: {
  userId: string
  name: string
  expiresIn: number | null
  permissions: { api: ApiKeyAccess[] }
}) => Promise<{ id: string; key: string }>

function accessOf(permissions: string | null): ApiKeyAccess {
  const parsed = permissions ? (JSON.parse(permissions) as { api?: string[] }) : {}
  return parsed.api?.includes('write') ? 'write' : 'read'
}

// The user's keys, newest first, without their hashes.
export async function listApiKeys(db: Database, userId: string) {
  const rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      permissions: apikey.permissions,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastUsedAt: apikey.lastRequest,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, userId))
    .orderBy(desc(apikey.createdAt))
  return rows.map(({ permissions, name, ...row }) => ({
    ...row,
    name: name ?? '',
    access: accessOf(permissions),
  }))
}

// Returns the key itself, which is shown once and never stored.
export async function createApiKey(
  db: Database,
  issue: IssueApiKey,
  userId: string,
  input: CreateApiKeyInput,
) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(apikey)
    .where(eq(apikey.referenceId, userId))
  if (total >= limits.apiKeysPerUser) throw new AppError('LIMIT_REACHED', 'api_key_limit')
  const { id, key } = await issue({
    userId,
    name: input.name,
    expiresIn: lifetimeSeconds[input.lifetime],
    permissions: permissionsFor[input.access],
  })
  return { id, key }
}

export async function revokeApiKey(db: Database, userId: string, id: string) {
  const deleted = await db
    .delete(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.referenceId, userId)))
    .returning({ id: apikey.id })
  if (deleted.length === 0) throw new AppError('NOT_FOUND', 'api_key_not_found')
  return { id }
}

// The key in `Authorization: Bearer <key>`, or null when the request has none.
export function bearerKey(headers: Headers) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

// Refusals only a key's requests get. Their English messages stay out of errorMessages,
// which the browser loads with a translation of each.
const keyRefusals = {
  api_key_invalid: { status: 401, code: 'UNAUTHENTICATED', message: 'Invalid API key.' },
  api_key_expired: { status: 401, code: 'UNAUTHENTICATED', message: 'API key expired.' },
  login_domain_not_allowed: {
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Email domain not allowed.',
  },
  api_key_read_only: { status: 403, code: 'FORBIDDEN', message: 'API key is read-only.' },
  api_key_not_allowed: {
    status: 403,
    code: 'FORBIDDEN',
    message: 'API keys cannot make this call.',
  },
  api_rate_limited: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests.' },
} satisfies Record<string, { status: number; code: AppErrorCode; message: string }>

export class ApiKeyRefusal extends Error {
  readonly status: number
  readonly code: AppErrorCode

  constructor(reason: keyof typeof keyRefusals) {
    const { status, code, message } = keyRefusals[reason]
    super(message)
    this.name = 'ApiKeyRefusal'
    this.status = status
    this.code = code
  }
}

// What the plugin's verifyApiKey answers, as far as keyUser reads it.
type VerifiedKey = {
  valid: boolean
  error: { code?: string } | null
  key: { referenceId: string; permissions?: Record<string, string[]> | null } | null
}

export type KeyCheckDeps = {
  db: Database
  // auth.api.verifyApiKey without permissions, so a key that lacks the call's scope is told
  // apart from an unknown one (task 089, README point 5).
  verifyKey: (key: string) => Promise<VerifiedKey>
  rateLimitStore: RateLimitStore
  loginDomains: readonly string[]
}

// The user a key signs in, for a call that writes or only reads. Throws an ApiKeyRefusal,
// or an AppError for the refusals a session's calls share.
export function keyChecker(deps: KeyCheckDeps) {
  return async function keyUser(key: string, write: boolean): Promise<string> {
    const verified = await deps.verifyKey(key)
    if (!verified.valid || !verified.key) {
      const code = verified.error?.code
      if (code === 'RATE_LIMITED') throw new ApiKeyRefusal('api_rate_limited')
      if (code === 'KEY_EXPIRED') throw new ApiKeyRefusal('api_key_expired')
      // The plugin reports a failed database read as an invalid key, so a refusal while
      // the database is down would tell the client to replace a working key.
      if (!(await databaseAvailable(deps.db))) {
        throw new AppError('UNAVAILABLE', 'database_unavailable')
      }
      throw new ApiKeyRefusal('api_key_invalid')
    }
    if (write && !verified.key.permissions?.api?.includes('write')) {
      throw new ApiKeyRefusal('api_key_read_only')
    }

    const userId = verified.key.referenceId
    const [owner] = await deps.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
    if (!owner) throw new ApiKeyRefusal('api_key_invalid')
    // The login-domain policy applies to keys as it does to sessions, so a key outlives
    // neither a domain's removal from ALLOWED_LOGIN_DOMAINS nor a changed address.
    if (!loginDomainAllowed(owner.email, deps.loginDomains)) {
      throw new ApiKeyRefusal('login_domain_not_allowed')
    }

    // The count signedInUser keeps, so a user's writes share one rate whether they come
    // from the app or a key.
    if (write) {
      const { allowed } = await deps.rateLimitStore.consume(
        `write:${userId}`,
        rateLimits.writesPerUser,
      )
      if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
    }
    return userId
  }
}
