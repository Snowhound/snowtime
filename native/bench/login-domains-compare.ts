// Compares ALLOWED_LOGIN_DOMAINS after the list narrows (login-domains-fixture.ts) and Better
// Auth's error page, in development and in production, where it redirects instead.
import {
  ALLOWED_USER,
  BLOCKED_COOKIE,
  LOGIN_DOMAINS_ENV,
  loginDomainsDatabase,
} from '../../conformance/login-domains-fixture'
import type { OAuthObservation } from '../../conformance/oauth-flow'
import { startApp } from '../../perf/lib/app'
import { COMPANY, USERS } from '../../perf/lib/database'
import { startNative } from './native'

type Call = [label: string, path: string, expected: number, init?: RequestInit]

const json = { 'content-type': 'application/json' }
function signIn(body: unknown, cookie?: string): RequestInit {
  return {
    method: 'POST',
    headers: { ...json, ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  }
}
function blocked(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie: BLOCKED_COOKIE },
  }
}
const setActive = blocked({ method: 'POST', headers: json, body: '{"organizationId":null}' })

// In order: sign-out deletes the session the calls before it use.
const narrowed: Call[] = [
  ['session', '/api/v1/session', 200, blocked()],
  ['running timer', '/api/v1/timer', 401, blocked()],
  [
    'project write',
    `/api/v1/organizations/${COMPANY.id}/projects`,
    401,
    blocked({ method: 'POST', headers: json, body: '{"name":"Blocked domain"}' }),
  ],
  ['sign-in outside the list', '/api/auth/sign-in/email', 403, signIn(USERS.admin)],
  [
    'sign-in outside the list, wrong password',
    '/api/auth/sign-in/email',
    401,
    signIn({ ...USERS.admin, password: 'not-the-password' }),
  ],
  [
    'sign-in on the list with the old session',
    '/api/auth/sign-in/email',
    403,
    signIn(ALLOWED_USER, BLOCKED_COOKIE),
  ],
  [
    'invalid sign-in body with the old session',
    '/api/auth/sign-in/email',
    403,
    signIn({}, BLOCKED_COOKIE),
  ],
  ['error page with the old session', '/api/auth/error?error=state_not_found', 403, blocked()],
  ['passkey list', '/api/auth/passkey/list-user-passkeys', 403, blocked()],
  ['passkey sign-in options', '/api/auth/passkey/generate-authenticate-options', 403, blocked()],
  ['account list', '/api/auth/list-accounts', 403, blocked()],
  [
    'social sign-in',
    '/api/auth/sign-in/social',
    403,
    blocked({ method: 'POST', headers: json, body: '{"provider":"google"}' }),
  ],
  [
    'invitation acceptance',
    '/api/auth/organization/accept-invitation',
    403,
    blocked({ method: 'POST', headers: json, body: '{}' }),
  ],
  ['set active organization', '/api/auth/organization/set-active', 403, setActive],
  ['sign-out', '/api/auth/sign-out', 200, blocked({ method: 'POST' })],
  ['set active organization after sign-out', '/api/auth/organization/set-active', 401, setActive],
]

const escaped = encodeURIComponent(`<b title="x">'a' & b &amp; &#39; &#x41; &#; ü</b>`)
const errorPages: Call[] = [
  ['no query', '/api/auth/error', 0],
  ['known code', '/api/auth/error?error=state_not_found', 0],
  ['code with an apostrophe', "/api/auth/error?error=it's", 0],
  ['description to escape', `/api/auth/error?error=access_denied&error_description=${escaped}`, 0],
  [
    'invalid code, plus signs, empty description',
    '/api/auth/error?error=a+b&error_description=',
    0,
  ],
  [
    'first of repeated codes',
    '/api/auth/error?error=%3Cx%3E&error=second&error_description=x+y%ZZ',
    0,
  ],
]

async function observe(url: string, [label, path, expected, init = {}]: Call, page: boolean) {
  const headers = { ...(init.headers as Record<string, string>), origin: url }
  const response = await fetch(`${url}${path}`, { ...init, headers, redirect: 'manual' })
  const body = await response.text()
  // The error page's content type and redirect are part of its answer. Refusals' JSON
  // content type differs in its charset, as on every native JSON answer.
  const text = page
    ? `${response.headers.get('content-type')}\n${response.headers.get('location')}\n${body}`
    : body
  return { label, status: response.status, expected: expected || response.status, text }
}

export async function compareLoginDomains(
  binary: string,
  database: string,
  judge: (label: string, a: OAuthObservation, b: OAuthObservation) => void,
) {
  const fixture = await loginDomainsDatabase(database)
  for (const [mode, env, calls] of [
    ['narrowed', LOGIN_DOMAINS_ENV, narrowed],
    ['development error page', {}, errorPages],
    ['production error page', { NODE_ENV: 'production' }, errorPages],
  ] as const) {
    const ts = await startApp({ database: fixture, env })
    let native: Awaited<ReturnType<typeof startNative>> | undefined
    try {
      native = await startNative(binary, fixture, env)
      for (const call of calls) {
        const a = await observe(ts.url, call, mode !== 'narrowed')
        const b = await observe(native.url, call, mode !== 'narrowed')
        for (const r of [a, b])
          if (r.status !== r.expected)
            throw new Error(`${mode} ${r.label}: ${r.status}, expected ${r.expected}: ${r.text}`)
        if (mode !== 'narrowed' && a.status !== (mode === 'production error page' ? 302 : 200))
          throw new Error(`${mode} ${a.label}: ${a.status}`)
        judge(`${mode}, ${call[0]}`, a, b)
      }
    } finally {
      await Promise.all([ts.stop(), native?.stop()])
    }
  }
}
