// Personal API keys: the api-key plugin's options, and the rules Settings calls. The plugin
// creates a key, because only it generates and hashes one; listing and revoking read and
// delete the plugin's rows directly (docs/architecture/auth.md, "API keys").
import type { apiKey } from '@better-auth/api-key'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '~/db'
import { apikey } from '~/db/schema'
import { AppError } from '../errors'
import { limits, rateLimits } from '../limits.server'
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
  // A key reaches only /api/v1, whose routes verify it themselves; with this on, the plugin
  // would turn a key into a session for server functions and /api/auth/* too.
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

// The plugin's create call, as the server function binds it. Called without request
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
}
