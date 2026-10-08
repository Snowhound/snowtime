import { createClient } from '@libsql/client'
import { createHmac } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OAuthObservation } from '../../conformance/oauth-flow'
import { oauthEnv, startOAuthProvider } from '../../conformance/oauth-provider'
import { signInHeaders, startApp } from '../../perf/lib/app'
import { SEED_NOW, USERS } from '../../perf/lib/database'
import { startNative } from './native'

function signed(name: string, value: string) {
  return `${name}=${encodeURIComponent(`${value}.${createHmac('sha256', 'perf-harness-secret-perf-harness-secret').update(value).digest('base64')}`)}`
}

export async function compareOAuthFixtures(
  binary: string,
  database: string,
  judge: (label: string, a: OAuthObservation, b: OAuthObservation) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'snowtime-oauth-fixtures-'))
  const copy = join(directory, 'seed.db')
  cpSync(database, copy)
  const db = createClient({ url: `file:${copy}` })
  const admin = (
    await db.execute({ sql: 'select id from user where email=?', args: [USERS.admin.email] })
  ).rows[0].id!
  const member = (
    await db.execute({ sql: 'select id from user where email=?', args: [USERS.member.email] })
  ).rows[0].id!
  const now = SEED_NOW.getTime()
  const stateData = {
    callbackURL: '/timer',
    codeVerifier: 'fixture-verifier',
    errorURL: '/sign-in',
    expiresAt: now - 1,
    oauthState: 'expired',
  }
  await db.execute({
    sql: 'insert into verification(id,identifier,value,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
    args: [
      'cleanup-victim',
      'auth-state:cleanup-victim',
      JSON.stringify({ ...stateData, oauthState: 'cleanup-victim' }),
      now - 1,
      now,
      now,
    ],
  })
  await db.execute({
    sql: 'insert into verification(id,identifier,value,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
    args: ['expired', 'auth-state:expired', JSON.stringify(stateData), now - 1, now, now],
  })
  await db.execute({
    sql: 'insert into verification(id,identifier,value,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
    args: [
      'mismatch',
      'auth-state:mismatch',
      JSON.stringify({ ...stateData, expiresAt: now + 600000, oauthState: 'wrong' }),
      now + 600000,
      now,
      now,
    ],
  })
  await db.execute({
    sql: 'insert into account(id,account_id,provider_id,user_id,scope,created_at,updated_at) values (?,?,?,?,?,?,?)',
    args: [
      'imported-google',
      'imported-subject',
      'google',
      admin,
      'email, profile,,extra',
      now,
      now,
    ],
  })
  await db.execute({
    sql: 'insert into account(id,account_id,provider_id,user_id,scope,created_at,updated_at) values (?,?,?,?,?,?,?)',
    args: ['foreign-google', 'foreign-subject', 'google', member, 'email', now, now],
  })
  await db.execute({
    sql: 'insert into session(id,user_id,token,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
    args: ['stale', admin, 'stale-token', now + 86400000, now - 86400001, now],
  })
  await db.execute({ sql: 'update user set email_verified=0 where id=?', args: [member] })
  db.close()
  const provider = startOAuthProvider()
  const observations: OAuthObservation[][] = [[], []]
  async function flow(app: { url: string }, out: OAuthObservation[], restricted = false) {
    let cookie = restricted
      ? ''
      : (await signInHeaders(app, 'admin')).cookie
          .split('; ')
          .filter((p) => !p.includes('session_data'))
          .join('; ')
    async function call(
      label: string,
      path: string,
      body: unknown,
      expected: number,
      explicit?: string,
    ) {
      const response = await fetch(`${app.url}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          cookie: explicit ?? cookie,
          origin: app.url,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      })
      const text = await response.text()
      const location = response.headers.get('location')
      out.push({
        label,
        status: response.status,
        expected,
        text:
          text.replaceAll(app.url, '$HOST') +
          (location ? `\nLocation: ${location.replaceAll(app.url, '$HOST')}` : ''),
      })
      return { response, text }
    }
    if (!restricted) {
      await call('imported account listing', '/list-accounts', undefined, 200)
      for (const state of ['expired', 'mismatch']) {
        await call(
          `${state} persisted state`,
          `/callback/google?state=${state}&code=bad`,
          undefined,
          302,
          signed('better-auth.state', state),
        )
        await call(
          `${state} second click`,
          `/callback/google?state=${state}&code=bad`,
          undefined,
          302,
          signed('better-auth.state', state),
        )
      }
      const swept = await call(
        'lookup removes unrelated expired state',
        '/callback/google?state=cleanup-victim&code=bad',
        undefined,
        302,
        signed('better-auth.state', 'cleanup-victim'),
      )
      if (
        swept.response.headers.get('location') !== `${app.url}/api/auth/error?error=state_mismatch`
      )
        throw new Error('Expired verification row survived another state lookup')
      const stale = signed('better-auth.session_token', 'stale-token')
      await call(
        'stale unlink refuses',
        '/unlink-account',
        { accountId: 'imported-google' },
        403,
        stale,
      )
      await call('stale list allows', '/list-accounts', undefined, 200, stale)
      await call(
        'foreign account unlink refuses',
        '/unlink-account',
        { accountId: 'foreign-google' },
        400,
      )
      // Compare the rejection before any provider traffic or state masking is needed.
      await call(
        'link foreign origin',
        '/link-social',
        { provider: 'google', callbackURL: 'https://evil.example/' },
        403,
      )
    }
    const bodies = restricted
      ? [
          { email: 'blocked@elsewhere.example', verified: true, id: 'blocked' },
          { email: 'allowed@example.com', verified: true, id: 'allowed' },
        ]
      : [{ email: USERS.member.email, verified: true, id: 'local-unverified' }]
    for (const { email, verified, id } of bodies) {
      const response = await fetch(`${app.url}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: app.url },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: `${app.url}/timer`,
          errorCallbackURL: `${app.url}/sign-in`,
        }),
      })
      const { url } = (await response.json()) as { url: string }
      const state = new URL(url).searchParams.get('state')!
      const stateCookie = response.headers
        .getSetCookie()
        .filter((c) => c.startsWith('better-auth.state='))
        .map((c) => c.split(';')[0])
        .join('; ')
      const { code } = (await fetch(`${provider.url}/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          authorizationURL: url,
          profile: { sub: id, name: 'Fixture', email, email_verified: verified },
        }),
      }).then((r) => r.json())) as { code: string }
      await call(
        `${id} policy callback`,
        `/callback/google?state=${state}&code=${code}`,
        undefined,
        302,
        stateCookie,
      )
      const stats = (await fetch(`${provider.url}/stats`).then((r) => r.json())) as {
        exchanges: number
      }
      if (stats.exchanges < 1) throw new Error('Provider exchange not exercised')
    }
  }
  try {
    for (const restricted of [false, true]) {
      const env = {
        ...oauthEnv(provider.url),
        ...(restricted ? { ALLOWED_LOGIN_DOMAINS: 'example.com' } : {}),
      }
      const ts = await startApp({ database: copy, env })
      let native: Awaited<ReturnType<typeof startNative>> | undefined
      try {
        native = await startNative(binary, copy, env)
        observations[0] = []
        observations[1] = []
        await flow(ts, observations[0], restricted)
        await flow(native, observations[1], restricted)
        for (const [i, a] of observations[0].entries()) {
          const b = observations[1][i]
          if (a.label !== b?.label) throw new Error('OAuth fixture sequence differs')
          if (a.status !== a.expected || b.status !== b.expected)
            throw new Error(
              `OAuth fixture ${a.label}: ${a.status}/${b.status}, expected ${a.expected}`,
            )
          judge(`oauth fixture ${a.label}`, a, b)
        }
      } finally {
        await Promise.all([ts.stop(), native?.stop()])
      }
    }
  } finally {
    await provider.stop()
    rmSync(directory, { recursive: true, force: true })
  }
}
