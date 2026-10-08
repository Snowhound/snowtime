import { createClient } from '@libsql/client'
import { createHmac } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PasskeyAuthenticator } from '../../conformance/passkey-authenticator'
import { type PasskeyObservation } from '../../conformance/passkey-flow'
import { startApp } from '../../perf/lib/app'
import { CACHE, SEED_NOW, USERS } from '../../perf/lib/database'
import { startNative } from './native'

function signed(token: string) {
  return encodeURIComponent(
    `${token}.${createHmac('sha256', 'perf-harness-secret-perf-harness-secret').update(token).digest('base64')}`,
  )
}
export async function comparePasskeyFixtures(
  binary: string,
  source: string,
  judge: (label: string, a: PasskeyObservation, b: PasskeyObservation) => void,
) {
  const directory = mkdtempSync(join(CACHE, 'passkey-fixtures-'))
  const database = join(directory, 'fixture.db')
  cpSync(source, database)
  const client = createClient({ url: `file:${database}` })
  const authenticator = new PasskeyAuthenticator()
  const challenge = Buffer.alloc(32, 42).toString('base64url')
  const now = SEED_NOW.getTime()
  try {
    const users = await client.execute({
      sql: 'select id from user where email=?',
      args: [USERS.admin.email],
    })
    const userId = users.rows[0].id
    if (typeof userId !== 'string') throw new Error('Fixture user ID is not text')
    await client.execute({
      sql: 'insert into session (id,user_id,token,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
      args: [
        'fixture-stale-session',
        userId,
        'fixture-stale-token',
        now + 86400000,
        now - 86400000,
        now,
      ],
    })
    await client.execute({
      sql: 'insert into passkey (id,name,public_key,user_id,credential_id,counter,device_type,backed_up,transports,created_at,aaguid) values (?,?,?,?,?,0,?,0,?,?,?)',
      args: [
        'fixture-imported-key',
        'Imported COSE key',
        authenticator.publicKey.toString('base64'),
        userId,
        authenticator.id,
        'singleDevice',
        'internal',
        now,
        '00000000-0000-0000-0000-000000000000',
      ],
    })
    for (const [identifier, type, expiresAt] of [
      ['expired', 'authentication', now - 1],
      ['imported', 'authentication', now + 300000],
      ['zero-counter', 'authentication', now + 300000],
    ] as const) {
      await client.execute({
        sql: 'insert into verification (id,identifier,value,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
        args: [
          `fixture-${identifier}`,
          `fixture-${identifier}`,
          JSON.stringify({ type, expectedChallenge: challenge, userData: { id: '' } }),
          expiresAt,
          now,
          now,
        ],
      })
    }
  } finally {
    client.close()
  }
  const ts = await startApp({ database, env: { CLIENT_IP_HEADER: 'x-bench-ip' } })
  let native: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    native = await startNative(binary, database, { CLIENT_IP_HEADER: 'x-bench-ip' })
    async function observations(server: { url: string }) {
      const results: PasskeyObservation[] = []
      async function call(
        label: string,
        path: string,
        expected: number,
        cookie: string,
        body?: unknown,
      ) {
        const response = await fetch(`${server.url}/api/auth/passkey/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            cookie,
            origin: server.url,
            'x-bench-ip': '127.0.0.1',
            'content-type': 'application/json',
            'user-agent': 'a'.repeat(512),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        let text = await response.text()
        if (response.status === 200 && path === 'verify-authentication') {
          const { session } = JSON.parse(text)
          if (session.id[14] !== '7' || !/^[a-zA-Z0-9]{32}$/.test(session.token))
            throw new Error('Invalid imported-key session')
          text = text
            .replaceAll(JSON.stringify(session.id), '"$sessionId"')
            .replaceAll(JSON.stringify(session.token), '"$sessionToken"')
        }
        if (path === 'verify-authentication' && response.ok) {
          const userAt = text.indexOf(',"user":')
          text =
            text
              .slice(0, userAt)
              .replaceAll(/"(?:createdAt|updatedAt|expiresAt)":"[^"]*"/g, (field) =>
                field.replace(/:"[^"]*"$/, ':"$time"'),
              ) + text.slice(userAt)
        }
        if (response.status !== expected)
          throw new Error(`${label}: expected ${expected}, got ${response.status}: ${text}`)
        results.push({ label, status: response.status, expected, text })
      }
      const session = `better-auth.session_token=${signed('fixture-stale-token')}`
      await call('stale session cannot register options', 'generate-register-options', 403, session)
      await call('stale session cannot register', 'verify-registration', 403, session, {
        response: {},
      })
      await call('stale session can list', 'list-user-passkeys', 200, session)
      const expired = `better-auth.better-auth-passkey=${signed('fixture-expired')}`
      await call('expired challenge', 'verify-authentication', 400, expired, {
        response: authenticator.authentication(challenge, server.url),
      })
      await call('expired challenge replay', 'verify-authentication', 400, expired, {
        response: authenticator.authentication(challenge, server.url),
      })
      await call(
        'tampered challenge cookie',
        'verify-authentication',
        400,
        'better-auth.better-auth-passkey=fixture-imported.invalid',
        { response: authenticator.authentication(challenge, server.url) },
      )
      const zero = `better-auth.better-auth-passkey=${signed('fixture-zero-counter')}`
      await call('imported key without a signature counter', 'verify-authentication', 200, zero, {
        response: authenticator.authentication(challenge, server.url, 0),
      })
      const imported = `better-auth.better-auth-passkey=${signed('fixture-imported')}`
      await call('imported COSE key in a fresh host', 'verify-authentication', 200, imported, {
        response: authenticator.authentication(challenge, server.url),
      })
      await call('imported counter stored', 'list-user-passkeys', 200, session)
      await call('stale session can remove', 'delete-passkey', 200, session, {
        id: 'fixture-imported-key',
      })
      return results
    }
    const a = await observations(ts)
    const b = await observations(native)
    for (const [i, result] of a.entries()) judge(`passkey fixtures ${result.label}`, result, b[i])
  } finally {
    await Promise.all([ts.stop(), native?.stop()])
    rmSync(directory, { recursive: true, force: true })
  }
}
