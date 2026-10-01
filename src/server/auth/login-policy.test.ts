import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Database } from '~/db'
import * as schema from '~/db/schema'
import { SEED_PASSWORD, seed } from '~/db/seed'
import { createTestDatabase } from '~/db/testing'
import { loginDomainAllowed, parseLoginDomains } from '~/lib/login-domains'
import {
  loginDomainHooks,
  loginDomainMiddleware,
  loginDomainSessionAllowed,
} from './login-policy.server'

test('domain lists normalize case and optional @, and reject invalid configuration', () => {
  expect(parseLoginDomains(' @Snowhound.eu, example.com,snowhound.eu ')).toEqual([
    'snowhound.eu',
    'example.com',
  ])
  for (const value of [
    '*',
    'https://snowhound.eu',
    'snowhound.eu,',
    '.eu',
    'snowhound',
    'bad_domain.eu',
  ]) {
    expect(() => parseLoginDomains(value)).toThrow()
  }
})

test('only exact email domains are allowed, with an unrestricted default', () => {
  expect(loginDomainAllowed('Kait@Snowhound.eu', ['snowhound.eu'])).toBe(true)
  for (const email of [
    'person@evil-snowhound.eu',
    'person@sub.snowhound.eu',
    'person@snowhound.eu.evil',
    'a@b@snowhound.eu',
    '@snowhound.eu',
  ]) {
    expect(loginDomainAllowed(email, ['snowhound.eu'])).toBe(false)
  }
  expect(loginDomainAllowed('person@anywhere.example', [])).toBe(true)
})

describe('login policy on Better Auth endpoints', () => {
  let db: Database
  let cleanup: () => Promise<void>
  let domains = ['example.com']

  beforeAll(async () => {
    const fixture = await createTestDatabase()
    db = fixture.db
    cleanup = fixture.cleanup
    await seed(db)
  })
  afterAll(async () => cleanup())

  function instance() {
    const hooks = loginDomainHooks(domains, (id) => db.query.user.findFirst({ where: { id } }))
    return betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'test-login-policy-secret-at-least-32-characters',
      database: drizzleAdapter(db, { provider: 'sqlite', schema }),
      emailAndPassword: { enabled: true },
      session: { cookieCache: { enabled: true } },
      databaseHooks: hooks,
      hooks: {
        before: loginDomainMiddleware(domains),
        after: createAuthMiddleware(async (ctx) => {
          if (
            ctx.path === '/get-session' &&
            !loginDomainSessionAllowed(domains, ctx.context.returned)
          )
            return ctx.json(null)
          return undefined
        }),
      },
    })
  }

  test('refuses signup outside the list before creating a user', async () => {
    await expect(
      instance().api.signUpEmail({
        body: {
          name: 'Outside',
          email: 'outside@other.example',
          password: SEED_PASSWORD,
        },
      }),
    ).rejects.toMatchObject({ body: { code: 'LOGIN_DOMAIN_NOT_ALLOWED' } })
    expect(
      await db.query.user.findFirst({ where: { email: 'outside@other.example' } }),
    ).toBeUndefined()
  })

  test('permits an allowed login and blocks an existing account when the list changes', async () => {
    const signedIn = await instance().api.signInEmail({
      body: { email: 'owner@example.com', password: SEED_PASSWORD },
      returnHeaders: true,
    })
    expect(signedIn.response.user.email).toBe('owner@example.com')
    const headers = new Headers({
      cookie: signedIn.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    expect((await instance().api.getSession({ headers }))?.user.email).toBe('owner@example.com')
    domains = ['snowhound.eu']
    const restricted = instance()
    expect(Boolean(await restricted.api.getSession({ headers }))).toBe(false)
    await expect(
      restricted.api.signInEmail({ body: { email: 'owner@example.com', password: SEED_PASSWORD } }),
    ).rejects.toMatchObject({ body: { code: 'LOGIN_DOMAIN_NOT_ALLOWED' } })
    await expect(
      restricted.api.updateUser({ body: { name: 'Cannot change' }, headers }),
    ).rejects.toMatchObject({ body: { code: 'LOGIN_DOMAIN_NOT_ALLOWED' } })
    await restricted.api.signOut({ headers })
    domains = ['example.com']
  })

  test('applies the session hook to every authentication method and rejects unknown users', async () => {
    const hooks = loginDomainHooks(['snowhound.eu'], async () => ({ email: 'owner@example.com' }))
    await expect(hooks.session.create.before({ userId: 'existing' })).rejects.toMatchObject({
      body: { code: 'LOGIN_DOMAIN_NOT_ALLOWED' },
    })
    const missing = loginDomainHooks(['snowhound.eu'], async () => null)
    await expect(missing.session.create.before({ userId: 'missing' })).rejects.toMatchObject({
      body: { code: 'LOGIN_DOMAIN_NOT_ALLOWED' },
    })
  })
})
