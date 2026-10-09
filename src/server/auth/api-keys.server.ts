// Personal API keys: the api-key plugin's options, the rules Settings calls, and the check
// that signs a JSON API request in with a key. The plugin creates a key, because only it
// generates one; listing, revoking, and checking a request's key read and change the
// plugin's rows directly (docs/architecture/auth.md, "API keys").
import type { apiKey } from '@better-auth/api-key'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '~/db'
import { apikey, user } from '~/db/schema'
import { loginDomainAllowed } from '~/lib/login-domains'
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
  // The JSON API checks a key itself (keyChecker); with this on, the plugin would turn a key
  // into a session for /api/auth/* and every call too.
  enableSessionForAPIKeys: false,
  // The list names keys and shows no part of one.
  startingCharactersConfig: { shouldStore: false },
  // No default: the plugin applies one whenever expiresIn is empty, which would rule out a
  // key that never expires. Creation always passes the user's choice.
  keyExpiration: { defaultExpiresIn: null },
  // keyChecker counts a key's requests in the app's rate-limit store instead.
  rateLimit: { enabled: false },
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

export async function revokeApiKey(db: Database, userId: string, { id }: { id: string }) {
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

// The hash the plugin stores for a key: SHA-256 as unpadded base64url, as its
// defaultKeyHasher makes it. The plugin doesn't export the hasher; a test checks this
// against keys it creates.
export async function hashKey(key: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Buffer.from(digest).toString('base64url')
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

// How often a key's last use is saved: Settings shows it, and no check depends on it.
const LAST_USE_PRECISION_MS = 60_000

export type KeyCheckDeps = {
  db: Database
  rateLimitStore: RateLimitStore
  loginDomains: readonly string[]
  now?: () => Date
}

// The user a key signs in, for a call that writes or only reads, from one read of the key
// and its user. The plugin's verifyApiKey would add two writes to every request. `lastUse`
// saves the key's last use when the saved one is older than a minute; the caller awaits it
// after the response is ready, so it runs beside the call. Throws an ApiKeyRefusal, or an
// AppError for the refusals a session's calls share.
export function keyChecker({
  db,
  rateLimitStore,
  loginDomains,
  now = () => new Date(),
}: KeyCheckDeps) {
  return async function keyUser(key: string, write: boolean) {
    const [found] = await db
      .select({
        id: apikey.id,
        userId: apikey.referenceId,
        email: user.email,
        enabled: apikey.enabled,
        expiresAt: apikey.expiresAt,
        permissions: apikey.permissions,
        lastUsedAt: apikey.lastRequest,
      })
      .from(apikey)
      .innerJoin(user, eq(user.id, apikey.referenceId))
      .where(eq(apikey.key, await hashKey(key)))
    if (!found?.enabled) throw new ApiKeyRefusal('api_key_invalid')
    const time = now()
    if (found.expiresAt && found.expiresAt <= time) throw new ApiKeyRefusal('api_key_expired')
    if (write && accessOf(found.permissions) !== 'write') {
      throw new ApiKeyRefusal('api_key_read_only')
    }
    // The login-domain policy applies to keys as it does to sessions, so a key outlives
    // neither a domain's removal from ALLOWED_LOGIN_DOMAINS nor a changed address.
    if (!loginDomainAllowed(found.email, loginDomains)) {
      throw new ApiKeyRefusal('login_domain_not_allowed')
    }

    // A write also counts toward the rate signedInUser keeps, so a user's writes share one
    // rate whether they come from the app or a key.
    const [perKey, perUser] = await Promise.all([
      rateLimitStore.consume(`api-key:${found.id}`, rateLimits.apiKeyRequests),
      write ? rateLimitStore.consume(`write:${found.userId}`, rateLimits.writesPerUser) : null,
    ])
    if (!perKey.allowed) throw new ApiKeyRefusal('api_rate_limited')
    if (perUser && !perUser.allowed) throw new AppError('RATE_LIMITED', 'rate_limited')

    const due =
      !found.lastUsedAt || time.getTime() - found.lastUsedAt.getTime() >= LAST_USE_PRECISION_MS
    const lastUse = due ? saveLastUse(db, found.id, time) : null
    return { userId: found.userId, lastUse }
  }
}

// A failed save only leaves Settings showing an older last use, so it never fails the call.
async function saveLastUse(db: Database, id: string, time: Date) {
  try {
    await db.update(apikey).set({ lastRequest: time }).where(eq(apikey.id, id))
  } catch (error) {
    console.error('Saving an API key’s last use failed', error)
  }
}
