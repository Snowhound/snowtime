// Sends the same calls to the TypeScript build and a native server, each on its own copy of
// the benchmark database at SEED_NOW, and reports where the answers differ: in status, in
// content, or only in bytes (key order). Reads only, so both copies stay equal.
//
//   bun native/bench/compare.ts native/target/release/snowtime-axum

import { spawn } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { type OperationName, operations } from '~/lib/api/operations'
import { requestOf } from '~/lib/api/wire'
import { buildApp, signInHeaders, startApp } from '../../perf/lib/app'
import { CACHE, COMPANY, SEED_NOW, seededDatabase } from '../../perf/lib/database'

const [binary] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/compare.ts <binary>')

const DAY = 86_400_000
const organizationId = COMPANY.id

async function startNative(database: string) {
  const port = 3290 + Math.floor(Math.random() * 100)
  const url = `http://127.0.0.1:${port}`
  const copy = join(CACHE, `native-${port}.db`)
  cpSync(database, copy)
  const server = spawn(binary, [], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      PERF_NOW: String(SEED_NOW.getTime()),
      TURSO_DATABASE_URL: `file:${copy}`,
      BETTER_AUTH_SECRET: 'perf-harness-secret-perf-harness-secret',
      BETTER_AUTH_URL: url,
    },
  })
  for (let waited = 0; ; waited += 100) {
    if (
      await fetch(`${url}/api/v1/availability`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    if (waited > 10_000) throw new Error(`[native] ${binary} didn't answer`)
    await Bun.sleep(100)
  }
  return {
    url,
    stop: async () => {
      server.kill()
      rmSync(copy, { force: true })
    },
  }
}

const database = await seededDatabase()
await buildApp()
const [ts, native] = await Promise.all([startApp({ database }), startNative(database)])

try {
  const sessions = {
    ts: { admin: await signInHeaders(ts, 'admin'), member: await signInHeaders(ts, 'member') },
    native: {
      admin: await signInHeaders(native, 'admin'),
      member: await signInHeaders(native, 'member'),
    },
  }
  const memberEntries = (await (
    await fetch(
      `${ts.url}${requestOf(operations.listEntries, { organizationId, from: new Date(SEED_NOW.getTime() - 30 * DAY), to: SEED_NOW }).path}`,
      { headers: sessions.ts.member },
    )
  ).json()) as { userId: string }[]
  const memberId = memberEntries[0].userId

  const week = { from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z') }
  const quarter = { from: new Date(SEED_NOW.getTime() - 92 * DAY), to: SEED_NOW }
  const cases: [string, OperationName, unknown, 'admin' | 'member' | null][] = [
    ['running timer, none', 'getRunningTimer', undefined, 'admin'],
    ['signed out', 'getRunningTimer', undefined, null],
    ['week, admin', 'listEntries', { organizationId, ...week }, 'admin'],
    ['week, member', 'listEntries', { organizationId, ...week }, 'member'],
    ['92 days, admin', 'listEntries', { organizationId, ...quarter }, 'admin'],
    [
      '92 days of the member, admin',
      'listEntries',
      { organizationId, ...quarter, userId: memberId },
      'admin',
    ],
    ['range too long', 'listEntries', { organizationId, from: new Date(0), to: SEED_NOW }, 'admin'],
    ['range reversed', 'listEntries', { organizationId, from: SEED_NOW, to: week.from }, 'admin'],
    ['first entry start', 'getFirstEntryStart', { organizationId, userId: memberId }, 'admin'],
    [
      'first entry start, member',
      'getFirstEntryStart',
      { organizationId, userId: memberId },
      'member',
    ],
    ['another organization', 'listEntries', { organizationId: 'nope', ...week }, 'admin'],
    ['stop, not running', 'stopTimer', { id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' }, 'admin'],
    ['stop, bad id', 'stopTimer', { id: 'x' }, 'admin'],
    [
      'update, missing',
      'updateEntry',
      { organizationId, id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd', description: 'x' },
      'admin',
    ],
    [
      'delete, missing',
      'deleteEntry',
      { organizationId, id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' },
      'member',
    ],
  ]
  let differences = 0
  for (const [label, name, input, who] of cases) {
    const operation = operations[name]
    const { path, body } = requestOf(operation, input)
    async function call(server: { url: string }, session: Record<string, string>) {
      const headers: Record<string, string> = { ...session, origin: server.url }
      if (body) headers['content-type'] = 'application/json'
      const response = await fetch(`${server.url}${path}`, {
        method: operation.method,
        headers,
        body,
      })
      return { status: response.status, text: await response.text() }
    }
    const a = await call(ts, who ? sessions.ts[who] : {})
    const b = await call(native, who ? sessions.native[who] : {})
    const same = a.status === b.status && a.text === b.text
    const equal = a.status === b.status && isDeepStrictEqual(JSON.parse(a.text), JSON.parse(b.text))
    const verdict = same ? 'same bytes' : equal ? 'same content, other bytes' : 'DIFFERENT'
    if (!equal) differences++
    console.log(`${verdict.padEnd(26)} ${label} (${a.status}, ${a.text.length} bytes)`)
    if (!equal)
      console.log(
        `  ts:     ${a.status} ${a.text.slice(0, 300)}\n  native: ${b.status} ${b.text.slice(0, 300)}`,
      )
  }
  console.log(differences ? `${differences} calls differ` : 'Every call answers the same')
} finally {
  await Promise.all([ts.stop(), native.stop()])
}
process.exit(0)
