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
import { limits } from '../limits.server'
import { createSeededDatabase } from '../testing'
import {
  apiKeyDisabledPaths,
  apiKeyOptions,
  createApiKey,
  type IssueApiKey,
  listApiKeys,
  revokeApiKey,
} from './api-keys.server'
import { CreateApiKeyInput } from './auth.schemas'

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

  test('creates a key the plugin verifies, with the burst limit set', async () => {
    const { id, key } = await createApiKey(db, issue, U.lead, input({ access: 'write' }))
    const result = await auth.api.verifyApiKey({
      body: { key, permissions: { api: ['write'] } },
    })
    expect(result.valid).toBe(true)
    expect(result.key?.referenceId).toBe(U.lead)
    const row = await stored(id)
    expect(row.rateLimitMax).toBe(60)
    expect(row.rateLimitTimeWindow).toBe(5000)
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
    const error = await errorOf(revokeApiKey(db, U.admin, id))
    expect(error).toMatchObject({ code: 'NOT_FOUND', key: 'api_key_not_found' })
    expect((await auth.api.verifyApiKey({ body: { key } })).valid).toBe(true)
  })

  test('deletes the key, which then stops verifying', async () => {
    const { id, key } = await createApiKey(db, issue, U.owner, input())
    await revokeApiKey(db, U.owner, id)
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
