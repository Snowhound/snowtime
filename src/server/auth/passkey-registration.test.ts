import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import * as schema from '~/db/schema'
import { createTestDatabase } from '~/db/testing'
import fixture from './test-fixtures/passkey-registration.json'

const origin = 'http://localhost:3000'
let db: Database
let cleanup: () => Promise<void>
let auth: ReturnType<typeof createAuth>
let sessionCookie: string

function createAuth(db: Database) {
  return betterAuth({
    secret: 'a'.repeat(32),
    baseURL: origin,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: { database: { generateId: () => uuidv7() } },
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    plugins: [passkey({ rpID: 'localhost', rpName: 'Snowtime', origin })],
  })
}

function cookies(headers: Headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  auth = createAuth(db)
  const signedUp = await auth.api.signUpEmail({
    body: { name: 'Nora', email: 'nora@example.com', password: 'correct-horse-battery' },
    returnHeaders: true,
  })
  sessionCookie = cookies(signedUp.headers)
})
afterAll(() => cleanup())

async function register(malformed = false) {
  const options = await auth.api.generatePasskeyRegistrationOptions({
    headers: new Headers({ cookie: sessionCookie }),
    returnHeaders: true,
  })
  const response = {
    ...fixture,
    response: {
      ...fixture.response,
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: options.response.challenge,
          origin,
          crossOrigin: false,
        }),
      ).toString('base64url'),
      ...(malformed && { attestationObject: 'AA' }),
    },
  }
  return auth.handler(
    new Request(`${origin}/api/auth/passkey/verify-registration`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        cookie: `${sessionCookie}; ${cookies(options.headers)}`,
      },
      body: JSON.stringify({ response }),
    }),
  )
}

test('malformed attestation returns 400', async () => {
  const response = await register(true)
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({
    code: 'FAILED_TO_VERIFY_REGISTRATION',
    message: 'Failed to verify registration',
  })
})

test('valid attestation still registers', async () => {
  const response = await register()
  expect(response.status).toBe(200)
  expect((await response.json()).credentialID).toBe(fixture.id)
})

test('database failure after valid verification retains 500', async () => {
  await db.run(
    sql`CREATE TRIGGER fail_passkey_insert BEFORE INSERT ON passkey BEGIN SELECT RAISE(ABORT, 'test database failure'); END`,
  )
  try {
    const response = await register()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'FAILED_TO_VERIFY_REGISTRATION',
      message: 'Failed to verify registration',
    })
  } finally {
    await db.run(sql`DROP TRIGGER fail_passkey_insert`)
  }
})
