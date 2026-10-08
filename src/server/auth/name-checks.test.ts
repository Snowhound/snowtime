/// <reference types="bun" />

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import * as schema from '~/db/schema'
import { createTestDatabase } from '~/db/testing'
import { errorMessage } from '~/lib/errors'
import { databaseHooks, organizationHooks } from './name-checks.server'

const long = 'x'.repeat(101)

let db: Database
let cleanup: () => Promise<void>
let auth: ReturnType<typeof createAuth>
let headers: Headers

// Better Auth as the app configures it, with only what the name checks touch.
function createAuth(db: Database) {
  return betterAuth({
    secret: 'a'.repeat(32),
    baseURL: 'http://localhost:3000',
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: { database: { generateId: () => uuidv7() } },
    emailAndPassword: { enabled: true },
    databaseHooks,
    plugins: [organization({ organizationHooks })],
  })
}

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  auth = createAuth(db)
  const signUp = await auth.api.signUpEmail({
    body: { name: 'Nora', email: 'nora@example.com', password: 'correct-horse-battery' },
    returnHeaders: true,
  })
  headers = new Headers({
    cookie: signUp.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  })
})

afterAll(() => cleanup())

// The refusal's code, and the message the browser shows for it.
async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => undefined,
    (error: unknown) => error as { body?: { code?: string } },
  )
  const code = error?.body?.code
  return { code, message: errorMessage({ code }) }
}

describe('name checks', () => {
  test("the user's own name", async () => {
    expect(await refusal(auth.api.updateUser({ body: { name: long }, headers }))).toEqual({
      code: 'NAME_TOO_LONG',
      message: 'Use at most 100 characters.',
    })
    expect(await refusal(auth.api.updateUser({ body: { name: '  ' }, headers }))).toEqual({
      code: 'NAME_REQUIRED',
      message: 'Enter a name.',
    })
    await auth.api.updateUser({ body: { name: 'Nora Nightingale' }, headers })
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
    expect(session?.user.name).toBe('Nora Nightingale')
  })

  test("an organization's name and slug", async () => {
    function create(name: string, slug: string) {
      return auth.api.createOrganization({ body: { name, slug }, headers })
    }
    expect((await refusal(create(long, 'acme'))).code).toBe('NAME_TOO_LONG')
    expect(await refusal(create('Acme', 'Acme Co'))).toEqual({
      code: 'SLUG_FORMAT',
      message: 'Use lowercase letters, numbers, and dashes.',
    })
    expect(await refusal(create('Acme', 'a'.repeat(49)))).toEqual({
      code: 'SLUG_TOO_LONG',
      message: 'Use at most 48 characters.',
    })
    expect((await refusal(create('Acme', 'timer'))).code).toBe('SLUG_RESERVED')

    const org = await create('Acme', 'acme')
    const organizationId = org.id
    function update(data: { name?: string; slug?: string }) {
      return auth.api.updateOrganization({ body: { organizationId, data }, headers })
    }
    expect((await refusal(update({}))).code).toBe('NO_FIELDS_TO_UPDATE')
    expect((await refusal(update({ name: long }))).code).toBe('NAME_TOO_LONG')
    expect((await refusal(update({ slug: 'acme-co' }))).code).toBe('SLUG_READ_ONLY')
    expect((await update({ name: 'Acme Co' }))?.name).toBe('Acme Co')
  })
})
