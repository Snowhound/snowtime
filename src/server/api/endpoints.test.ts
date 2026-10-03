/// <reference types="bun" />

import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import * as schema from '~/db/schema'
import { seedIds } from '~/db/seed'
import { apiKeyDisabledPaths, apiKeyOptions, createApiKey } from '../auth/api-keys.server'
import type { ApiKeyAccess } from '../auth/auth.schemas'
import { memoryStore } from '../rate-limit.server'
import { createSeededDatabase } from '../testing'
import { createApiRoute } from './api.server'
import { createEndpoints } from './endpoints.server'

const { users: U, orgs: O, projects: P, entries: E } = seedIds
const BASE = 'http://localhost:3000'
const DAY = 24 * 60 * 60 * 1000

let db: Database
let cleanup: () => Promise<void>
let v1: ReturnType<typeof createEndpoints>
const keys = new Map<string, string>()

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
  const auth = betterAuth({
    secret: 'a'.repeat(32),
    baseURL: BASE,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: { database: { generateId: () => uuidv7() } },
    disabledPaths: apiKeyDisabledPaths,
    logger: { disabled: true },
    plugins: [apiKey(apiKeyOptions)],
  })
  const apiRoute = createApiRoute({
    db,
    verifyKey: (key) => auth.api.verifyApiKey({ body: { key } }),
    rateLimitStore: memoryStore(),
    loginDomains: [],
  })
  v1 = createEndpoints(apiRoute, db)
  for (const userId of Object.values(U)) {
    const { key } = await createApiKey(db, (body) => auth.api.createApiKey({ body }), userId, {
      name: 'Test',
      lifetime: '90d',
      access: 'write' satisfies ApiKeyAccess,
    })
    keys.set(userId, key)
  }
})

afterAll(() => cleanup())

type Handler = (args: { request: Request; params: Record<string, string> }) => Promise<Response>

async function call(
  handler: Handler,
  userId: string,
  options: { path?: string; params?: Record<string, string>; body?: unknown } = {},
) {
  const response = await handler({
    request: new Request(`${BASE}/api/v1/${options.path ?? ''}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${keys.get(userId)}` },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    params: options.params ?? {},
  })
  // Response.json() is untyped; each test reads its own response shape.
  return { status: response.status, body: await response.json() }
}

describe('GET /api/v1/me', () => {
  test('answers the user and their organizations with roles', async () => {
    const { status, body } = await call(v1.me, U.admin)
    expect(status).toBe(200)
    expect(body).toEqual({
      user: { id: U.admin, name: 'Adam Admin', email: 'admin@example.com' },
      organizations: [
        { id: O.harbor, name: expect.any(String), slug: 'harbor', role: 'owner' },
        { id: O.northwind, name: expect.any(String), slug: 'northwind', role: 'admin' },
      ],
    })
  })
})

describe('the timer', () => {
  test('GET /api/v1/timer answers the running entry with its project, in ISO 8601', async () => {
    const { body } = await call(v1.runningTimer, U.member)
    expect(body.timer).toMatchObject({
      id: E.running,
      organizationId: O.northwind,
      stoppedAt: null,
      project: { id: P.website, name: expect.any(String) },
    })
    expect(body.timer.startedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(body.timer).not.toHaveProperty('createdBy')
  })

  test('GET /api/v1/timer answers null without a running timer', async () => {
    expect((await call(v1.runningTimer, U.loner)).body).toEqual({ timer: null })
  })

  test('POST /api/v1/orgs/:orgId/timer starts a timer, and a retry answers 409', async () => {
    const id = uuidv7()
    const params = { orgId: O.northwind }
    const first = await call(v1.startTimer, U.loner, {
      params,
      body: { id, description: 'Inbox', projectId: P.internal },
    })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      started: { id, description: 'Inbox', projectId: P.internal, stoppedAt: null },
      stopped: null,
    })
    const retry = await call(v1.startTimer, U.loner, { params, body: { id } })
    expect(retry.status).toBe(409)
    expect(retry.body.error.message).toBe('An entry with this id already exists.')
  })

  test('starting a timer answers the one it stopped', async () => {
    const first = uuidv7()
    const second = uuidv7()
    const params = { orgId: O.northwind }
    await call(v1.startTimer, U.lead, { params, body: { id: first } })
    const { body } = await call(v1.startTimer, U.lead, { params, body: { id: second } })
    expect(body.stopped).toMatchObject({ id: first, stoppedAt: expect.any(String) })
  })

  test('stopping a timer another one replaced answers 404 and leaves the new one running', async () => {
    const replaced = uuidv7()
    const current = uuidv7()
    const params = { orgId: O.harbor }
    await call(v1.startTimer, U.engineer, { params, body: { id: replaced } })
    await call(v1.startTimer, U.engineer, { params, body: { id: current } })

    const stale = await call(v1.stopTimer, U.engineer, { params: { entryId: replaced }, body: {} })
    expect(stale.status).toBe(404)
    expect(stale.body.error.message).toBe('This timer is not running.')
    expect((await call(v1.runningTimer, U.engineer)).body.timer.id).toBe(current)

    const stopped = await call(v1.stopTimer, U.engineer, { params: { entryId: current }, body: {} })
    expect(stopped.status).toBe(200)
    expect(stopped.body.stopped).toMatchObject({ id: current, stoppedAt: expect.any(String) })
  })

  test("starting in another organization's path answers 403", async () => {
    const { status } = await call(v1.startTimer, U.loner, {
      params: { orgId: O.harbor },
      body: { id: uuidv7() },
    })
    expect(status).toBe(403)
  })
})

describe('GET /api/v1/orgs/:orgId/projects', () => {
  test("answers the organization's active projects the user can see", async () => {
    const { body } = await call(v1.projects, U.admin, { params: { orgId: O.northwind } })
    const ids = body.projects.map((p: { id: string }) => p.id)
    expect(ids).toContain(P.website)
    expect(ids).not.toContain(P.legacy)
    expect(ids).not.toContain(P.scrapped)
    expect(Object.keys(body.projects[0]).sort()).toEqual(['color', 'id', 'name'])
  })
})

describe('GET /api/v1/orgs/:orgId/entries', () => {
  const now = Date.now()
  const range = `from=${new Date(now - 7 * DAY).toISOString()}&to=${new Date(now + DAY).toISOString()}`

  test('a member reads only their own entries, as in the web app', async () => {
    const all = await call(v1.entries, U.admin, {
      path: `orgs/${O.northwind}/entries?${range}`,
      params: { orgId: O.northwind },
    })
    expect(new Set(all.body.entries.map((e: { userId: string }) => e.userId)).size).toBeGreaterThan(
      1,
    )
    const { status, body } = await call(v1.entries, U.member, {
      path: `orgs/${O.northwind}/entries?${range}`,
      params: { orgId: O.northwind },
    })
    expect(status).toBe(200)
    expect(body.entries.length).toBeGreaterThan(0)
    expect(body.entries.every((e: { userId: string }) => e.userId === U.member)).toBe(true)
  })

  test("a member asking for another member's entries answers 403", async () => {
    const { status, body } = await call(v1.entries, U.loner, {
      path: `orgs/${O.northwind}/entries?${range}&userId=${U.member}`,
      params: { orgId: O.northwind },
    })
    expect(status).toBe(403)
    expect(body.error.message).toBe("You cannot see this member's entries.")
  })

  test('a team lead reads a member of their team', async () => {
    const { status, body } = await call(v1.entries, U.lead, {
      path: `orgs/${O.northwind}/entries?${range}&userId=${U.member}`,
      params: { orgId: O.northwind },
    })
    expect(status).toBe(200)
    expect(body.entries.map((e: { id: string }) => e.id)).toContain(E.running)
  })

  test('a range over the cap or not in ISO 8601 answers 422', async () => {
    const tooLong = await call(v1.entries, U.admin, {
      path: `orgs/${O.northwind}/entries?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`,
      params: { orgId: O.northwind },
    })
    expect(tooLong.status).toBe(422)
    const notIso = await call(v1.entries, U.admin, {
      path: `orgs/${O.northwind}/entries?from=yesterday&to=today`,
      params: { orgId: O.northwind },
    })
    expect(notIso.status).toBe(422)
  })
})
