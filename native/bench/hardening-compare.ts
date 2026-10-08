// Targeted production-limit and persisted-IP checks; development byte comparisons can't
// exercise Better Auth's limiter. GCRA retry durations differ from fixed-window durations.
import { createClient } from '@libsql/client'
import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import { buildApp, startApp } from '../../perf/lib/app'
import { CACHE, USERS, seededDatabase } from '../../perf/lib/database'
import { startNative } from './native'

const [binary] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/hardening-compare.ts <native binary>')
await buildApp()
const database = await seededDatabase()
let checks = 0

async function sessionIps(header: string | undefined, address: string, expected: string) {
  const env: Record<string, string> = header ? { CLIENT_IP_HEADER: header } : {}
  const ts = await startApp({ database, env })
  let native: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    native = await startNative(binary, database, { ...env, RATE_LIMIT: 'off' })
    for (const [server, prefix] of [
      [ts, 'run'],
      [native, 'native'],
    ] as const) {
      const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          origin: server.url,
          'content-type': 'application/json',
          [header ?? 'x-untrusted-ip']: address,
        },
        body: JSON.stringify(USERS.admin),
      })
      assert.equal(response.status, 200)
      const client = createClient({
        url: `file:${join(CACHE, `${prefix}-${new URL(server.url).port}.db`)}`,
      })
      try {
        const result = await client.execute(
          'select ip_address from session order by rowid desc limit 1',
        )
        assert.equal(result.rows[0].ip_address, expected)
      } finally {
        client.close()
      }
    }
    const health = await fetch(`${native.url}/readyz`).then((r) => r.json())
    assert.equal(health.rate_limit, false)
    checks++
    console.log(`persisted IP matches TypeScript: ${header ?? 'TCP peer'} (${expected})`)
  } finally {
    await Promise.all([ts.stop(), native?.stop()])
  }
}
await sessionIps(undefined, '203.0.113.99', '127.0.0.1')
await sessionIps('x-bench-ip', '203.0.113.7', '203.0.113.7')
await sessionIps('x-bench-ip', '::ffff:192.0.2.7', '192.0.2.7')
await sessionIps('x-bench-ip', '2001:db8:abcd:1234::7', '2001:0db8:abcd:1234:0000:0000:0000:0000')

const env = { NODE_ENV: 'production', DEMO_MODE: 'true', CLIENT_IP_HEADER: 'x-bench-ip' }
const ts = await startApp({ database, env })
let native: Awaited<ReturnType<typeof startNative>> | undefined
try {
  native = await startNative(binary, database, env)
  assert.equal((await fetch(`${native.url}/readyz`).then((r) => r.json())).rate_limit, true)
  const rules: [string, number, number][] = [
    ['/sign-in/email', 10, 3],
    ['/sign-in/social', 10, 3],
    ['/sign-up/email', 10, 3],
    ['/change-password', 10, 3],
    ['/change-email', 10, 3],
    ['/request-password-reset', 60, 3],
    ['/send-verification-email', 60, 3],
    ['/forget-password', 60, 3],
    ['/email-otp/send-verification-otp', 60, 3],
    ['/email-otp/request-password-reset', 60, 3],
    ['/organization/create', 3600, 10],
    ['/organization/invite-member', 60, 30],
    ['/get-session', 10, 100],
  ]
  for (const [index, [path, window, max]] of rules.entries()) {
    const refusals: { body: string; type: string | null; retry: number }[] = []
    const servers: { url: string }[] = [ts, native]
    for (const server of servers) {
      let response: Response | undefined
      for (let count = 0; count < max * 2 + 5; count++) {
        response = await fetch(`${server.url}/api/auth${path}`, {
          method: path === '/get-session' ? 'GET' : 'POST',
          headers: {
            origin: server.url,
            'content-type': 'application/json',
            'x-bench-ip': `203.0.113.${index + 1}`,
          },
          ...(path === '/get-session' ? {} : { body: '{}' }),
        })
        await response.arrayBuffer()
        if (response.status === 429) break
      }
      assert.equal(response?.status, 429, path)
      // Repeat without spending a new token, so its body can be inspected.
      const refused: Response = await fetch(`${server.url}/api/auth${path}`, {
        method: path === '/get-session' ? 'GET' : 'POST',
        headers: {
          origin: server.url,
          'content-type': 'application/json',
          'x-bench-ip': `203.0.113.${index + 1}`,
        },
        ...(path === '/get-session' ? {} : { body: '{}' }),
      })
      assert.equal(refused.status, 429)
      assert.equal(refused.headers.get('retry-after'), null)
      assert.equal(refused.headers.get('x-ratelimit-after'), null)
      const retry = refused.headers.get('x-retry-after')
      assert.match(retry ?? '', /^[1-9]\d*$/)
      refusals.push({
        body: await refused.text(),
        type: refused.headers.get('content-type'),
        retry: Number(retry),
      })
    }
    assert.equal(refusals[0].body, refusals[1].body)
    assert.equal(refusals[0].type, refusals[1].type)
    assert.equal(refusals[0].body, '{"message":"Too many requests. Please try again later."}')
    assert.equal(refusals[0].retry, window)
    assert.ok(refusals[1].retry > 0 && refusals[1].retry <= Math.ceil(window / max))
    checks++
    console.log(
      `production 429 bytes and headers match: ${path} (TS ${refusals[0].retry}s; GCRA ${refusals[1].retry}s)`,
    )
  }
} finally {
  await Promise.all([ts.stop(), native?.stop()])
}
console.log(`${checks} targeted checks passed`)
