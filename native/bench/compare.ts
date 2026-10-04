// Sends the same calls to the TypeScript build and a native server, each on its own copy of
// the benchmark database at SEED_NOW, and reports where the answers differ: in status, in
// content, or only in bytes (key order). Reads only, so both copies stay equal.
//
//   bun native/bench/compare.ts native/target/release/snowtime-axum

import { spawn } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { buildApp, signInHeaders, startApp } from '../../perf/lib/app'
import { CACHE, COMPANY, SEED_NOW, seededDatabase } from '../../perf/lib/database'
import { CALLS, type CallName, requestOf } from './calls'

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

let differences = 0
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
      `${ts.url}${requestOf(CALLS.listEntries, { organizationId, from: new Date(SEED_NOW.getTime() - 30 * DAY), to: SEED_NOW }).path}`,
      { headers: sessions.ts.member },
    )
  ).json()) as { userId: string }[]
  const memberId = memberEntries[0].userId

  const week = { from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z') }
  const quarter = { from: new Date(SEED_NOW.getTime() - 92 * DAY), to: SEED_NOW }
  const cases: [
    string,
    CallName,
    unknown,
    'admin' | 'member' | null,
    { body?: string; origin?: false }?,
  ][] = [
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
    ['projects, admin', 'listProjects', { organizationId }, 'admin'],
    [
      'projects with archived, admin',
      'listProjects',
      { organizationId, includeArchived: true },
      'admin',
    ],
    ['projects, member', 'listProjects', { organizationId }, 'member'],
    [
      'projects with archived, member',
      'listProjects',
      { organizationId, includeArchived: true },
      'member',
    ],
    [
      'projects without archived, member',
      'listProjects',
      { organizationId, includeArchived: false },
      'member',
    ],
    [
      'projects, flag not a boolean',
      'listProjects',
      { organizationId, includeArchived: 'yes' },
      'member',
    ],
    ['projects, another organization', 'listProjects', { organizationId: 'nope' }, 'member'],
  ]
  const id = '0192f3a4-5b6c-7d8e-9f01-23456789abcd'
  for (const value of [undefined, null, 3, true, [], {}, 'bad']) {
    const label = JSON.stringify(value) ?? 'absent'
    cases.push(
      [`stop id ${label}`, 'stopTimer', { id: value }, 'admin'],
      [
        `start description ${label}`,
        'startTimer',
        { organizationId, id: 'bad', description: value },
        'admin',
      ],
      [`entry user ${label}`, 'createEntry', { organizationId, id, userId: value }, 'admin'],
      [`entry start ${label}`, 'createEntry', { organizationId, id, startedAt: value }, 'admin'],
      [
        `range from ${label}`,
        'listEntries',
        { organizationId, from: value, to: SEED_NOW },
        'admin',
      ],
      [
        `update description ${label}`,
        'updateEntry',
        { organizationId, id, description: value },
        'admin',
      ],
      [`update start ${label}`, 'updateEntry', { organizationId, id, startedAt: value }, 'admin'],
    )
  }
  cases.push(
    ['malformed JSON', 'stopTimer', {}, 'admin', { body: '{' }],
    ['session before JSON', 'stopTimer', {}, null, { body: '{' }],
    ['origin before JSON', 'stopTimer', {}, 'admin', { body: '{', origin: false }],
    ['scope before JSON', 'createEntry', { organizationId: 'nope' }, 'admin', { body: '{' }],
    [
      'path over body',
      'deleteEntry',
      { organizationId, id },
      'admin',
      { body: '{"id":"bad","organizationId":"nope"}' },
    ],
  )
  for (const [label, name, input, who, options] of cases) {
    const operation = CALLS[name]
    const request = requestOf(operation, input)
    const { path } = request
    const body = options?.body ?? request.body
    async function call(server: { url: string }, session: Record<string, string>) {
      const headers: Record<string, string> = { ...session, origin: server.url }
      if (options?.origin === false) delete headers.origin
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
    if (!same) differences++
    console.log(`${verdict.padEnd(26)} ${label} (${a.status}, ${a.text.length} bytes)`)
    if (!same)
      console.log(
        `  ts:     ${a.status} ${a.text.slice(0, 300)}\n  native: ${b.status} ${b.text.slice(0, 300)}`,
      )
  }
  console.log(differences ? `${differences} calls differ` : 'Every call answers the same')
} finally {
  await Promise.all([ts.stop(), native.stop()])
}
process.exit(differences ? 1 : 0)
