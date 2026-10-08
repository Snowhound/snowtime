// ALLOWED_LOGIN_DOMAINS after the list narrows (docs/architecture/auth.md, "Sign-in methods"):
// an existing session outside it is signed out of the API, refused by Better Auth's routes,
// and can still sign out; password sign-in applies the list as passkeys and OAuth do. The
// server runs on login-domains-fixture.ts's database and environment;
// native/bench/conformance.ts starts the native server that way.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { buildApp, startApp } from '../perf/lib/app'
import { COMPANY, USERS, seededDatabase } from '../perf/lib/database'
import {
  ALLOWED_USER,
  BLOCKED_COOKIE,
  LOGIN_DOMAINS_ENV,
  loginDomainsDatabase,
} from './login-domains-fixture'
import { refused, send } from './server'

let server: { url: string; stop: () => Promise<void> }
beforeAll(async () => {
  if (process.env.CONFORMANCE_URL) {
    server = { url: process.env.CONFORMANCE_URL, stop: async () => {} }
  } else {
    await buildApp()
    server = await startApp({
      database: await loginDomainsDatabase(await seededDatabase()),
      env: LOGIN_DOMAINS_ENV,
    })
  }
}, 120_000)
afterAll(() => server?.stop())

const domainRefusal = {
  code: 'LOGIN_DOMAIN_NOT_ALLOWED',
  message: 'This email domain cannot sign in to this instance.',
}

function blocked() {
  return { cookie: BLOCKED_COOKIE, origin: server.url }
}

async function auth(path: string, init: RequestInit = {}) {
  const response = await fetch(`${server.url}/api/auth${path}`, init)
  return {
    status: response.status,
    sessionCookie: response.headers
      .getSetCookie()
      .some((cookie) => /^better-auth\.session_token=[^;]/.test(cookie)),
    body: (await response.json()) as unknown,
  }
}

function signIn(credentials: { email: string; password: string }, cookie?: string) {
  return auth('/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: server.url,
      ...(cookie && { cookie }),
    },
    body: JSON.stringify(credentials),
  })
}

describe('a session from before the list narrowed', () => {
  test('the API treats it as signed out', async () => {
    expect(await send(server.url, 'getAppSession', undefined, blocked())).toEqual({
      status: 200,
      body: null,
    })
    expect(await send(server.url, 'getRunningTimer', undefined, blocked())).toEqual({
      status: 401,
      body: refused('UNAUTHENTICATED', 'sign_in_required'),
    })
    expect(
      await send(
        server.url,
        'createProject',
        { organizationId: COMPANY.id, name: 'Blocked domain' },
        blocked(),
      ),
    ).toEqual({ status: 401, body: refused('UNAUTHENTICATED', 'sign_in_required') })
  })

  test("Better Auth's routes refuse it before their own checks", async () => {
    expect(await auth('/passkey/list-user-passkeys', { headers: blocked() })).toEqual({
      status: 403,
      sessionCookie: false,
      body: domainRefusal,
    })
    expect(
      await auth('/organization/set-active', {
        method: 'POST',
        headers: { ...blocked(), 'content-type': 'application/json' },
        body: '{"organizationId":null}',
      }),
    ).toEqual({ status: 403, sessionCookie: false, body: domainRefusal })
    expect(await signIn(ALLOWED_USER, BLOCKED_COOKIE)).toEqual({
      status: 403,
      sessionCookie: false,
      body: domainRefusal,
    })
  })

  test('it can sign out, which deletes it', async () => {
    expect(await auth('/sign-out', { method: 'POST', headers: blocked() })).toEqual({
      status: 200,
      sessionCookie: false,
      body: { success: true },
    })
    expect(
      (
        await auth('/organization/set-active', {
          method: 'POST',
          headers: { ...blocked(), 'content-type': 'application/json' },
          body: '{"organizationId":null}',
        })
      ).status,
    ).toBe(401)
  })
})

describe('password sign-in', () => {
  test('refuses a correct password outside the list without a session', async () => {
    expect(await signIn(USERS.admin)).toEqual({
      status: 403,
      sessionCookie: false,
      body: domainRefusal,
    })
    expect(await signIn({ ...USERS.admin, password: 'not-the-password' })).toEqual({
      status: 401,
      sessionCookie: false,
      body: { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' },
    })
  })

  test('signs in an address on the list', async () => {
    const answer = await signIn(ALLOWED_USER)
    expect(answer).toMatchObject({
      status: 200,
      sessionCookie: true,
      body: { user: { email: ALLOWED_USER.email } },
    })
  })
})
