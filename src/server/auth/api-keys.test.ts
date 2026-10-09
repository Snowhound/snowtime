/// <reference types="bun" />

import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'
import type { Database } from '~/db'
import * as schema from '~/db/schema'
import { seedIds } from '~/db/seed'
import { getLocale } from '~/paraglide/runtime.js'
import { paraglideMiddleware } from '~/paraglide/server.js'
import { AppError } from '../errors'
import { limits, rateLimits } from '../limits.server'
import { localeRequest } from '../locale.server'
import { memoryStore } from '../rate-limit.server'
import { createSeededDatabase } from '../testing'
import {
  ApiKeyRefusal,
  apiKeyDisabledPaths,
  apiKeyOptions,
  bearerKey,
  createApiKey,
  hashKey,
  type IssueApiKey,
  type KeyCheckDeps,
  keyChecker,
  listApiKeys,
  revokeApiKey,
} from './api-keys.server'
import { type ApiKeyAccess, CreateApiKeyInput } from './auth.schemas'

const { users: U } = seedIds
const DAY = 24 * 60 * 60 * 1000

let db: Database
let cleanup: () => Promise<void>
let auth: ReturnType<typeof createAuth>
let issue: IssueApiKey

// Better Auth with the app's API key setup and nothing else.
function createAuth(db: Database) {
  return betterAuth({
    secret: 'a'.repeat(32),
    baseURL: 'http://localhost:3000',
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: { database: { generateId: () => uuidv7() } },
    disabledPaths: apiKeyDisabledPaths,
    // A revoked key's refusal is expected here; the plugin would log it as an error.
    logger: { disabled: true },
    plugins: [apiKey(apiKeyOptions)],
  })
}

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
  auth = createAuth(db)
  issue = (body) => auth.api.createApiKey({ body })
})

afterAll(() => cleanup())

function input(overrides: Partial<CreateApiKeyInput> = {}): CreateApiKeyInput {
  return { name: 'Raycast', lifetime: '90d', access: 'read', ...overrides }
}

async function stored(id: string) {
  const [row] = await db.select().from(schema.apikey).where(eq(schema.apikey.id, id))
  return row
}

async function errorOf(call: Promise<unknown>) {
  return call.then(
    () => undefined,
    (error: unknown) => error as { code?: string; key?: string },
  )
}

describe('createApiKey', () => {
  test('returns the key once and stores only its hash, with no starting characters', async () => {
    const { id, key } = await createApiKey(db, issue, U.member, input())
    expect(key).toStartWith('snow_')
    const row = await stored(id)
    expect(row.key).not.toBe(key)
    expect(row.key).not.toContain(key.slice(5, 15))
    expect(row.start).toBeNull()
    expect(row.referenceId).toBe(U.member)
  })

  test('sets the chosen lifetime, or none', async () => {
    const before = Date.now()
    const ninety = await createApiKey(db, issue, U.member, input({ lifetime: '90d' }))
    const year = await createApiKey(db, issue, U.member, input({ lifetime: '1y' }))
    const never = await createApiKey(db, issue, U.member, input({ lifetime: 'none' }))
    async function expiresIn(id: string) {
      return (await stored(id)).expiresAt!.getTime() - before
    }
    expect(await expiresIn(ninety.id)).toBeGreaterThanOrEqual(90 * DAY)
    expect(await expiresIn(ninety.id)).toBeLessThan(90 * DAY + 60_000)
    expect(await expiresIn(year.id)).toBeGreaterThanOrEqual(365 * DAY)
    expect((await stored(never.id)).expiresAt).toBeNull()
  })

  test('maps access to the plugin permissions, write including read', async () => {
    const read = await createApiKey(db, issue, U.lead, input({ access: 'read' }))
    const write = await createApiKey(db, issue, U.lead, input({ access: 'write' }))
    expect(JSON.parse((await stored(read.id)).permissions!)).toEqual({ api: ['read'] })
    expect(JSON.parse((await stored(write.id)).permissions!)).toEqual({ api: ['read', 'write'] })
  })

  test("stores the hash keyChecker looks keys up by, as the plugin's own verify does", async () => {
    const { id, key } = await createApiKey(db, issue, U.lead, input({ access: 'write' }))
    expect((await stored(id)).key).toBe(await hashKey(key))
    const result = await auth.api.verifyApiKey({
      body: { key, permissions: { api: ['write'] } },
    })
    expect(result.valid).toBe(true)
    expect(result.key?.referenceId).toBe(U.lead)
  })

  test('refuses past the cap per user', async () => {
    const now = new Date()
    await db.insert(schema.apikey).values(
      Array.from({ length: limits.apiKeysPerUser }, (_, i) => ({
        id: uuidv7(),
        referenceId: U.loner,
        key: `hash-${i}`,
        createdAt: now,
        updatedAt: now,
      })),
    )
    const error = await errorOf(createApiKey(db, issue, U.loner, input()))
    expect(error).toMatchObject({ code: 'LIMIT_REACHED', key: 'api_key_limit' })
  })

  test('the input requires a name of at most 32 characters and a known lifetime', () => {
    expect(v.safeParse(CreateApiKeyInput, input({ name: '  ' })).success).toBe(false)
    expect(v.safeParse(CreateApiKeyInput, input({ name: 'x'.repeat(33) })).success).toBe(false)
    expect(v.safeParse(CreateApiKeyInput, { ...input(), lifetime: '7d' }).success).toBe(false)
    expect(v.safeParse(CreateApiKeyInput, { name: 'x', access: 'read' }).success).toBe(false)
  })
})

describe('listApiKeys', () => {
  test("lists only the user's own keys, newest first, without hashes", async () => {
    const first = await createApiKey(db, issue, U.engineer, input({ name: 'First' }))
    const second = await createApiKey(
      db,
      issue,
      U.engineer,
      input({ name: 'Second', access: 'write' }),
    )
    await createApiKey(db, issue, U.engLead, input({ name: 'Someone else' }))
    const keys = await listApiKeys(db, U.engineer)
    expect(keys.map((k) => k.id)).toEqual([second.id, first.id])
    expect(keys[0]).toMatchObject({ name: 'Second', access: 'write', lastUsedAt: null })
    expect(keys[1]).toMatchObject({ name: 'First', access: 'read' })
    expect(keys[0]).not.toHaveProperty('key')
  })
})

describe('revokeApiKey', () => {
  test("refuses another user's key and leaves it working", async () => {
    const { id, key } = await createApiKey(db, issue, U.owner, input())
    const error = await errorOf(revokeApiKey(db, U.admin, { id }))
    expect(error).toMatchObject({ code: 'NOT_FOUND', key: 'api_key_not_found' })
    expect((await auth.api.verifyApiKey({ body: { key } })).valid).toBe(true)
  })

  test('deletes the key, which then stops verifying', async () => {
    const { id, key } = await createApiKey(db, issue, U.owner, input())
    await revokeApiKey(db, U.owner, { id })
    expect(await stored(id)).toBeUndefined()
    expect((await auth.api.verifyApiKey({ body: { key } })).valid).toBe(false)
  })
})

test("deleting a user deletes the user's keys", async () => {
  const userId = uuidv7()
  const now = new Date()
  await db.insert(schema.user).values({
    id: userId,
    name: 'Gone',
    email: 'gone@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  const { id } = await createApiKey(db, issue, userId, input())
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  expect(await stored(id)).toBeUndefined()
})

test("the plugin's HTTP endpoints are closed", async () => {
  for (const path of apiKeyDisabledPaths) {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(response.status).toBe(404)
  }
})

describe('keyUser', () => {
  function checker(overrides: Partial<KeyCheckDeps> = {}) {
    return keyChecker({ db, rateLimitStore: memoryStore(), loginDomains: [], ...overrides })
  }

  // The user a key signs in, with the last-use save done.
  function keyUser(overrides: Partial<KeyCheckDeps> = {}) {
    const check = checker(overrides)
    return async (key: string, write: boolean) => {
      const { userId, lastUse } = await check(key, write)
      await lastUse
      return userId
    }
  }

  async function newKey(userId: string, access: ApiKeyAccess = 'read') {
    return createApiKey(db, issue, userId, input({ access }))
  }

  async function refusalOf(call: Promise<unknown>) {
    const error = await errorOf(call)
    return error instanceof ApiKeyRefusal
      ? { status: error.status, code: error.code, message: error.message }
      : error
  }

  test("signs a valid key in as its user, and a write key's writes too", async () => {
    const { key } = await newKey(U.member, 'write')
    expect(await keyUser()(key, false)).toBe(U.member)
    expect(await keyUser()(key, true)).toBe(U.member)
  })

  test('refuses an unknown or revoked key with 401', async () => {
    const { id, key } = await newKey(U.member)
    await revokeApiKey(db, U.member, { id })
    for (const refused of ['snow_unknown', key]) {
      expect(await refusalOf(keyUser()(refused, false))).toEqual({
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Invalid API key.',
      })
    }
  })

  test('refuses an expired key and says so', async () => {
    const { id, key } = await newKey(U.member)
    await db
      .update(schema.apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apikey.id, id))
    expect(await refusalOf(keyUser()(key, false))).toMatchObject({ message: 'API key expired.' })
  })

  test('refuses a key whose user the login-domain policy refuses', async () => {
    const { key } = await newKey(U.member)
    expect(await refusalOf(keyUser({ loginDomains: ['snowhound.eu'] })(key, false))).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Email domain not allowed.',
    })
  })

  test('refuses a read-only key a write with 403', async () => {
    const { key } = await newKey(U.member, 'read')
    expect(await refusalOf(keyUser()(key, true))).toEqual({
      status: 403,
      code: 'FORBIDDEN',
      message: 'API key is read-only.',
    })
  })

  test("refuses past the key's own limit with 429", async () => {
    const { id, key } = await newKey(U.member)
    const store = memoryStore()
    for (let i = 0; i < rateLimits.apiKeyRequests.max; i++) {
      await store.consume(`api-key:${id}`, rateLimits.apiKeyRequests)
    }
    expect(await refusalOf(keyUser({ rateLimitStore: store })(key, false))).toMatchObject({
      status: 429,
    })
  })

  test('saves the last use at most once a minute, after the check', async () => {
    const { id, key } = await newKey(U.member)
    const start = new Date('2026-10-09T10:00:00Z')
    let now = start
    const check = checker({ now: () => now })
    const first = await check(key, false)
    expect(first.lastUse).not.toBeNull()
    await first.lastUse
    expect((await stored(id)).lastRequest).toEqual(start)
    now = new Date(start.getTime() + 59_000)
    expect((await check(key, false)).lastUse).toBeNull()
    now = new Date(start.getTime() + 60_000)
    await (
      await check(key, false)
    ).lastUse
    expect((await stored(id)).lastRequest).toEqual(now)
  })

  test('refuses a disabled key as an unknown one', async () => {
    const { id, key } = await newKey(U.member)
    await db.update(schema.apikey).set({ enabled: false }).where(eq(schema.apikey.id, id))
    expect(await refusalOf(keyUser()(key, false))).toMatchObject({ message: 'Invalid API key.' })
  })

  test("counts writes against the rate the user's session shares", async () => {
    const { key } = await newKey(U.lead, 'write')
    const store = memoryStore()
    for (let i = 0; i < rateLimits.writesPerUser.max; i++) {
      await store.consume(`write:${U.lead}`, rateLimits.writesPerUser)
    }
    expect(await keyUser({ rateLimitStore: store })(key, false)).toBe(U.lead)
    const error = await errorOf(keyUser({ rateLimitStore: store })(key, true))
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', key: 'rate_limited' })
  })

  test('the key signs in to neither a session nor /api/auth/*', async () => {
    const { key } = await newKey(U.member, 'write')
    const headers = new Headers({ authorization: `Bearer ${key}`, 'x-api-key': key })
    expect(await auth.api.getSession({ headers })).toBeNull()
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', { headers }),
    )
    expect(await response.json()).toBeNull()
  })

  test('bearerKey reads only a Bearer authorization', () => {
    expect(bearerKey(new Headers({ authorization: 'Bearer snow_abc' }))).toBe('snow_abc')
    expect(bearerKey(new Headers({ authorization: 'Basic snow_abc' }))).toBeNull()
    expect(bearerKey(new Headers())).toBeNull()
  })

  test("a key's API requests use English, and the app's own the user's language", async () => {
    const estonian = { cookie: 'PARAGLIDE_LOCALE=et', 'accept-language': 'et' }
    async function localeOf(path: string, headers: Record<string, string>) {
      const request = new Request(`http://localhost:3000${path}`, { headers })
      const response = await paraglideMiddleware(localeRequest(request), async () =>
        Response.json(getLocale()),
      )
      return response.json()
    }
    expect(await localeOf('/api/v1/timer', estonian)).toBe('et')
    expect(await localeOf('/api/v1/timer', { ...estonian, authorization: 'Bearer snow_abc' })).toBe(
      'en',
    )
  })
})
