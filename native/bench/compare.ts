// Sends the same calls to the TypeScript build and a native server, each on its own copy of
// the benchmark database at SEED_NOW, and reports where the answers differ: in status, in
// content, or only in bytes (key order). Reads only, so both copies stay equal. Fields that
// hold each server's own clock or sign-in time are masked.
//
//   bun native/bench/compare.ts native/target/release/snowtime-axum

import { isDeepStrictEqual } from 'node:util'
import { buildApp, signInHeaders, startApp } from '../../perf/lib/app'
import { COMPANY, SEED_NOW, USERS, seededDatabase } from '../../perf/lib/database'
import { companyIds } from '../../src/db/seed-company'
import { CALLS, type CallName, requestOf } from './calls'
import { startNative } from './native'

const [binary] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/compare.ts <binary>')

const DAY = 86_400_000
const organizationId = COMPANY.id

const database = await seededDatabase()
await buildApp()
const [ts, native] = await Promise.all([startApp({ database }), startNative(binary, database)])

type Server = { url: string }
type Who = 'admin' | 'member' | null
interface Options {
  body?: string
  origin?: false
  // Keys whose values differ by server: its clock, or when the caller signed in.
  mask?: string[]
}

let differences = 0
function judge(label: string, a: { status: number; text: string }, b: typeof a) {
  const same = a.status === b.status && a.text === b.text
  let equal = false
  try {
    equal = a.status === b.status && isDeepStrictEqual(JSON.parse(a.text), JSON.parse(b.text))
  } catch {}
  const verdict = same ? 'same bytes' : equal ? 'same content, other bytes' : 'DIFFERENT'
  if (!same) differences++
  console.log(`${verdict.padEnd(26)} ${label} (${a.status}, ${a.text.length} bytes)`)
  if (same) return
  // From a little before the first byte that differs.
  let at = 0
  while (at < a.text.length && a.text[at] === b.text[at]) at++
  const from = Math.max(0, at - 60)
  console.log(
    `  ts:     ${a.status} ${a.text.slice(from, from + 300)}\n  native: ${b.status} ${b.text.slice(from, from + 300)}`,
  )
}

function masked(text: string, keys: string[] = []) {
  return keys.reduce(
    (masking, key) => masking.replaceAll(new RegExp(`"${key}":"[^"]*"`, 'g'), `"${key}":"…"`),
    text,
  )
}

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
  const reportWeek = { organizationId, from: '2026-09-28', to: '2026-10-05', unit: 'day' }
  const unknown = '0192f3a4-5b6c-7d8e-9f01-23456789abcd'
  const now = { mask: ['now'] }
  const session = { mask: ['signedInAt', 'appUrl'] }
  const cases: [string, CallName, unknown, Who, Options?][] = [
    ['session, admin', 'getAppSession', undefined, 'admin', session],
    ['session, member', 'getAppSession', undefined, 'member', session],
    ['session, signed out', 'getAppSession', undefined, null],
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
    ['stop, not running', 'stopTimer', { id: unknown }, 'admin'],
    ['stop, bad id', 'stopTimer', { id: 'x' }, 'admin'],
    ['update, missing', 'updateEntry', { organizationId, id: unknown, description: 'x' }, 'admin'],
    ['delete, missing', 'deleteEntry', { organizationId, id: unknown }, 'member'],
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
    ['teams, admin', 'listTeams', { organizationId }, 'admin'],
    ['teams, member', 'listTeams', { organizationId }, 'member'],
    ['members, admin', 'listMembers', { organizationId }, 'admin'],
    ['members, member', 'listMembers', { organizationId }, 'member'],
    ['teams, another organization', 'listTeams', { organizationId: 'nope' }, 'admin'],
    ['report, week, admin', 'getReport', reportWeek, 'admin', now],
    ['report, week, member', 'getReport', reportWeek, 'member', now],
    [
      'report, quarter by week with tickets, admin',
      'getReport',
      { organizationId, from: '2026-07-01', to: '2026-10-01', unit: 'week', tickets: true },
      'admin',
      now,
    ],
    [
      'report, year, admin',
      'getReport',
      { organizationId, from: '2025-10-01', to: '2026-10-01' },
      'admin',
      now,
    ],
    ['report, without a project', 'getReport', { ...reportWeek, projectId: 'none' }, 'admin', now],
    ['report, of the member', 'getReport', { ...reportWeek, userId: memberId }, 'admin', now],
    [
      'report, of a team',
      'getReport',
      { ...reportWeek, teamId: companyIds.teams.web },
      'admin',
      now,
    ],
    [
      'report, of a team, member',
      'getReport',
      { ...reportWeek, teamId: companyIds.teams.web },
      'member',
    ],
    ['report, of an unknown team', 'getReport', { ...reportWeek, teamId: unknown }, 'member'],
    ['report, of another member', 'getReport', { ...reportWeek, userId: unknown }, 'member'],
    [
      'report, another organization',
      'getReport',
      { ...reportWeek, organizationId: 'nope' },
      'admin',
    ],
    ['report, reversed', 'getReport', { ...reportWeek, to: '2026-09-01' }, 'admin'],
    ['report, too long', 'getReport', { ...reportWeek, from: '2025-01-01' }, 'admin'],
    [
      'report, member and team',
      'getReport',
      { ...reportWeek, userId: memberId, teamId: companyIds.teams.web },
      'admin',
    ],
    ['report, unknown day', 'getReport', { ...reportWeek, from: '2026-02-30' }, 'admin'],
    ['report, no from', 'getReport', { organizationId, to: '2026-10-05' }, 'admin'],
  ]
  for (const value of [undefined, null, 3, true, false, [], {}, 'bad', 'none', '2026-13-01']) {
    const label = JSON.stringify(value) ?? 'absent'
    cases.push(
      [`stop id ${label}`, 'stopTimer', { id: value }, 'admin'],
      [
        `start description ${label}`,
        'startTimer',
        { organizationId, id: 'bad', description: value },
        'admin',
      ],
      [
        `entry user ${label}`,
        'createEntry',
        { organizationId, id: unknown, userId: value },
        'admin',
      ],
      [
        `entry start ${label}`,
        'createEntry',
        { organizationId, id: unknown, startedAt: value },
        'admin',
      ],
      [
        `range from ${label}`,
        'listEntries',
        { organizationId, from: value, to: SEED_NOW },
        'admin',
      ],
      [
        `update description ${label}`,
        'updateEntry',
        { organizationId, id: unknown, description: value },
        'admin',
      ],
      [
        `update start ${label}`,
        'updateEntry',
        { organizationId, id: unknown, startedAt: value },
        'admin',
      ],
      [`report from ${label}`, 'getReport', { ...reportWeek, from: value }, 'admin', now],
      [`report unit ${label}`, 'getReport', { ...reportWeek, unit: value }, 'admin', now],
      [`report project ${label}`, 'getReport', { ...reportWeek, projectId: value }, 'admin', now],
      [`report tickets ${label}`, 'getReport', { ...reportWeek, tickets: value }, 'admin', now],
      [`report team ${label}`, 'getReport', { ...reportWeek, teamId: value }, 'admin', now],
    )
  }
  cases.push(
    ['malformed JSON', 'stopTimer', {}, 'admin', { body: '{' }],
    ['session before JSON', 'stopTimer', {}, null, { body: '{' }],
    ['origin before JSON', 'stopTimer', {}, 'admin', { body: '{', origin: false }],
    ['scope before JSON', 'createEntry', { organizationId: 'nope' }, 'admin', { body: '{' }],
    ['report reads without an origin', 'getReport', reportWeek, 'admin', { origin: false, ...now }],
    [
      'path over body',
      'deleteEntry',
      { organizationId, id: unknown },
      'admin',
      { body: '{"id":"bad","organizationId":"nope"}' },
    ],
  )
  for (const [label, name, input, who, options] of cases) {
    const operation = CALLS[name]
    const request = requestOf(operation, input)
    const body = options?.body ?? request.body
    async function call(server: Server, session: Record<string, string>) {
      const headers: Record<string, string> = { ...session, origin: server.url }
      if (options?.origin === false) delete headers.origin
      if (body) headers['content-type'] = 'application/json'
      const response = await fetch(`${server.url}${request.path}`, {
        method: operation.method,
        headers,
        body,
      })
      return { status: response.status, text: masked(await response.text(), options?.mask) }
    }
    judge(
      label,
      await call(ts, who ? sessions.ts[who] : {}),
      await call(native, who ? sessions.native[who] : {}),
    )
  }

  // Better Auth's origin and CSRF checks on sign-in. A case that passes them signs in with a
  // wrong password, which both servers refuse alike.
  const wrong = JSON.stringify({ email: USERS.admin.email, password: 'wrong password' })
  const evil = 'https://evil.test'
  const signIns: [string, (server: Server) => Record<string, string>, string?][] = [
    ['sign-in, no origin or cookie', () => ({})],
    ['sign-in, app origin', (s) => ({ origin: s.url })],
    ['sign-in, foreign origin', () => ({ origin: evil })],
    ['sign-in, app referer', (s) => ({ referer: `${s.url}/sign-in` })],
    ['sign-in, cookie without origin', () => ({ cookie: 'other=1' })],
    ['sign-in, cookie and foreign origin', () => ({ cookie: 'other=1', origin: evil })],
    ['sign-in, cookie and app referer', (s) => ({ cookie: 'other=1', referer: `${s.url}/x` })],
    [
      'sign-in, cross-site navigation',
      () => ({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }),
    ],
    [
      'sign-in, fetch without origin',
      () => ({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }),
    ],
    ['sign-in, malformed body', (s) => ({ origin: s.url }), '{'],
    ['sign-in, malformed body, foreign origin', () => ({ origin: evil }), '{'],
    [
      'sign-in, malformed body, cookie and foreign origin',
      () => ({ cookie: 'other=1', origin: evil }),
      '{',
    ],
    ['sign-in, empty body', (s) => ({ origin: s.url }), '{}'],
    [
      'sign-in, empty body, cookie and foreign origin',
      () => ({ cookie: 'o=1', origin: evil }),
      '{}',
    ],
    ['sign-in, empty body, foreign origin', () => ({ origin: evil }), '{}'],
    ['sign-in, body not an object', (s) => ({ origin: s.url }), '3'],
    ['sign-in, null body', (s) => ({ origin: s.url }), 'null'],
    [
      'sign-in, wrong types',
      (s) => ({ origin: s.url }),
      '{"email":[],"password":null,"rememberMe":"yes"}',
    ],
    ['sign-in, invalid email', (s) => ({ origin: s.url }), '{"email":"x","password":"y"}'],
  ]
  for (const [label, headersOf, body] of signIns) {
    async function call(server: Server) {
      const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersOf(server) },
        body: body ?? wrong,
      })
      return { status: response.status, text: await response.text() }
    }
    judge(label, await call(ts), await call(native))
  }
  console.log(differences ? `${differences} calls differ` : 'Every call answers the same')
} finally {
  await Promise.all([ts.stop(), native.stop()])
}
process.exit(differences ? 1 : 0)
