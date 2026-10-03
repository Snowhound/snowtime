/// <reference types="bun" />

import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'
import type { Database } from '~/db'
import { currentActor } from '~/db/actor'
import * as schema from '~/db/schema'
import { SEED_PASSWORD, seedIds } from '~/db/seed'
import { getLocale } from '~/paraglide/runtime.js'
import { paraglideMiddleware } from '~/paraglide/server.js'
import {
  apiKeyDisabledPaths,
  apiKeyOptions,
  createApiKey,
  revokeApiKey,
} from '../auth/api-keys.server'
import type { ApiKeyAccess } from '../auth/auth.schemas'
import { AppError } from '../errors'
import { rateLimits } from '../limits.server'
import { localeRequest } from '../locale.server'
import { memoryStore, type RateLimitStore } from '../rate-limit.server'
import { Uuidv7 } from '../schemas'
import { createSeededDatabase } from '../testing'
import { type ApiDeps, createApiRoute } from './api.server'

const { users: U, orgs: O } = seedIds
const BASE = 'http://localhost:3000'

let db: Database
let cleanup: () => Promise<void>
let auth: ReturnType<typeof createAuth>

// Better Auth with the app's API key setup, and passwords for a session cookie.
function createAuth(db: Database) {
  return betterAuth({
    secret: 'a'.repeat(32),
    baseURL: BASE,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: { database: { generateId: () => uuidv7() } },
    emailAndPassword: { enabled: true },
    disabledPaths: apiKeyDisabledPaths,
    // Refused keys are expected here; the plugin would log each as an error.
    logger: { disabled: true },
    plugins: [apiKey(apiKeyOptions)],
  })
}

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
  auth = createAuth(db)
})

afterAll(() => cleanup())

function deps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    db,
    verifyKey: (key) => auth.api.verifyApiKey({ body: { key } }),
    rateLimitStore: memoryStore(),
    loginDomains: [],
    ...overrides,
  }
}

async function newKey(userId: string, access: ApiKeyAccess = 'read') {
  return createApiKey(db, (body) => auth.api.createApiKey({ body }), userId, {
    name: 'Test',
    lifetime: '90d',
    access,
  })
}

function request(key: string | null, init: RequestInit & { path?: string } = {}) {
  const headers = new Headers(init.headers)
  if (key) headers.set('authorization', `Bearer ${key}`)
  return new Request(`${BASE}/api/v1/${init.path ?? 'me'}`, { ...init, headers })
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string } }).error
}

// A route that answers who called it and as whom it ran.
async function whoami({ userId }: { userId: string }) {
  return { userId, actor: currentActor() }
}

describe('signing in', () => {
  test('a valid key runs the handler as its user', async () => {
    const { key } = await newKey(U.member)
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request(key), params: {} })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId: U.member, actor: U.member })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('no key answers 401', async () => {
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request(null), params: {} })
    expect(response.status).toBe(401)
    expect(await errorOf(response)).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'API key missing.',
    })
  })

  test('a session cookie without a key answers 401', async () => {
    const signedIn = await auth.api.signInEmail({
      body: { email: 'member@example.com', password: SEED_PASSWORD },
      returnHeaders: true,
    })
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]
    // The cookie is a working session elsewhere.
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull()

    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request(null, { headers: { cookie } }), params: {} })
    expect(response.status).toBe(401)
  })

  test('an unknown key answers 401', async () => {
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request('snow_unknown'), params: {} })
    expect(response.status).toBe(401)
    expect((await errorOf(response)).message).toBe('Invalid API key.')
  })

  test('an expired key answers 401 and says so', async () => {
    const { id, key } = await newKey(U.member)
    await db
      .update(schema.apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apikey.id, id))
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request(key), params: {} })
    expect(response.status).toBe(401)
    expect((await errorOf(response)).message).toBe('API key expired.')
  })

  test('a revoked key answers 401', async () => {
    const { id, key } = await newKey(U.member)
    await revokeApiKey(db, U.member, id)
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request(key), params: {} })
    expect(response.status).toBe(401)
  })

  test('a key whose user the login-domain policy refuses answers 401', async () => {
    const { key } = await newKey(U.member)
    const route = createApiRoute(deps({ loginDomains: ['snowhound.eu'] }))(
      { access: 'read' },
      whoami,
    )
    const response = await route({ request: request(key), params: {} })
    expect(response.status).toBe(401)
    expect((await errorOf(response)).message).toBe('Email domain not allowed.')
  })

  test('the key does not sign in to server functions or /api/auth/*', async () => {
    const { key } = await newKey(U.member, 'write')
    const headers = new Headers({ authorization: `Bearer ${key}`, 'x-api-key': key })
    // sessionMiddleware signs a server function in with getSession.
    expect(await auth.api.getSession({ headers })).toBeNull()
    const response = await auth.handler(new Request(`${BASE}/api/auth/get-session`, { headers }))
    expect(await response.json()).toBeNull()
  })
})

describe('scopes and rates', () => {
  test('a read-only key on a write route answers 403', async () => {
    const { key } = await newKey(U.member, 'read')
    const route = createApiRoute(deps())({ access: 'write' }, whoami)
    const response = await route({ request: request(key, { method: 'POST' }), params: {} })
    expect(response.status).toBe(403)
    expect((await errorOf(response)).code).toBe('FORBIDDEN')
  })

  test('a write key can read', async () => {
    const { key } = await newKey(U.member, 'write')
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    expect((await route({ request: request(key), params: {} })).status).toBe(200)
  })

  test("the key's own rate limit answers 429 with Retry-After", async () => {
    const { id, key } = await newKey(U.member)
    await db
      .update(schema.apikey)
      .set({ requestCount: rateLimits.apiKeyRequests.max, lastRequest: new Date() })
      .where(eq(schema.apikey.id, id))
    const route = createApiRoute(deps())({ access: 'read' }, whoami)
    const response = await route({ request: request(key), params: {} })
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  test('writes count against the rate the web app shares', async () => {
    const { key } = await newKey(U.lead, 'write')
    const store: RateLimitStore = memoryStore()
    for (let i = 0; i < rateLimits.writesPerUser.max; i++) {
      await store.consume(`write:${U.lead}`, rateLimits.writesPerUser)
    }
    const api = createApiRoute(deps({ rateLimitStore: store }))
    const read = await api({ access: 'read' }, whoami)({ request: request(key), params: {} })
    expect(read.status).toBe(200)
    const write = await api(
      { access: 'write' },
      whoami,
    )({
      request: request(key, { method: 'POST' }),
      params: {},
    })
    expect(write.status).toBe(429)
    expect(write.headers.get('retry-after')).not.toBeNull()
  })
})

describe('organizations', () => {
  test('a route under an organization gets its scope', async () => {
    const { key } = await newKey(U.lead)
    const route = createApiRoute(deps())(
      { access: 'read', organization: true },
      async ({ scope }) => scope,
    )
    const response = await route({ request: request(key), params: { orgId: O.northwind } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ organizationId: O.northwind, orgRole: 'member' })
  })

  test("another organization's path answers 403", async () => {
    const { key } = await newKey(U.loner)
    const route = createApiRoute(deps())(
      { access: 'read', organization: true },
      async ({ scope }) => scope,
    )
    const response = await route({ request: request(key), params: { orgId: O.harbor } })
    expect(response.status).toBe(403)
    expect((await errorOf(response)).message).toBe('You are not a member of this organization.')
  })
})

describe('input and errors', () => {
  const Input = v.object({ name: v.pipe(v.string(), v.nonEmpty('Name is required.')) })

  test('a GET reads its query, anything else its JSON body', async () => {
    const { key } = await newKey(U.member, 'write')
    const api = createApiRoute(deps())
    async function echo({ input }: { input: { name: string } }) {
      return input
    }
    const get = await api(
      { access: 'read', input: Input },
      echo,
    )({
      request: request(key, { path: 'me?name=Max' }),
      params: {},
    })
    expect(await get.json()).toEqual({ name: 'Max' })
    const post = await api(
      { access: 'write', input: Input },
      echo,
    )({
      request: request(key, { method: 'POST', body: JSON.stringify({ name: 'Max' }) }),
      params: {},
    })
    expect(await post.json()).toEqual({ name: 'Max' })
  })

  test("input the schema refuses answers 422 with the first issue's message", async () => {
    const { key } = await newKey(U.member, 'write')
    const route = createApiRoute(deps())({ access: 'write', input: Input }, async () => null)
    const invalid = await route({
      request: request(key, { method: 'POST', body: JSON.stringify({ name: '' }) }),
      params: {},
    })
    expect(invalid.status).toBe(422)
    expect(await errorOf(invalid)).toEqual({ code: 'INVALID', message: 'Name is required.' })
    const notJson = await route({
      request: request(key, { method: 'POST', body: '{' }),
      params: {},
    })
    expect(notJson.status).toBe(422)
  })

  test('messages are English whatever the language the request asks for', async () => {
    const { key } = await newKey(U.member, 'write')
    const route = createApiRoute(deps())(
      { access: 'write', input: v.object({ id: Uuidv7 }) },
      async () => null,
    )
    const estonian = { cookie: 'PARAGLIDE_LOCALE=et', 'accept-language': 'et' }
    // The same request elsewhere in the app renders in Estonian.
    const page = new Request(`${BASE}/sign-in`, { headers: estonian })
    const locale = await paraglideMiddleware(localeRequest(page), async () =>
      Response.json(getLocale()),
    )
    expect(await locale.json()).toBe('et')

    const api = request(key, { method: 'POST', headers: estonian, body: '{"id":"nope"}' })
    const response = await paraglideMiddleware(localeRequest(api), () =>
      route({ request: api, params: {} }),
    )
    expect(await errorOf(response)).toEqual({ code: 'INVALID', message: 'Invalid id.' })
  })

  test("an AppError answers its code's status", async () => {
    const { key } = await newKey(U.member)
    const route = createApiRoute(deps())({ access: 'read' }, async () => {
      throw new AppError('NOT_FOUND', 'entry_not_found')
    })
    const response = await route({ request: request(key), params: {} })
    expect(response.status).toBe(404)
    expect(await errorOf(response)).toEqual({ code: 'NOT_FOUND', message: 'Entry not found.' })
  })

  test('any other error answers 500 without details', async () => {
    const { key } = await newKey(U.member)
    const route = createApiRoute(deps())({ access: 'read' }, async () => {
      throw new Error('secret detail')
    })
    const logged = console.error
    console.error = () => {}
    try {
      const response = await route({ request: request(key), params: {} })
      expect(response.status).toBe(500)
      expect(await errorOf(response)).toEqual({
        code: 'INTERNAL',
        message: 'Something went wrong.',
      })
    } finally {
      console.error = logged
    }
  })
})
