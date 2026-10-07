// Sends the same calls to the TypeScript build and a native server, each on its own copy of
// the benchmark database at SEED_NOW, and reports where the answers differ: in status, in
// content, or only in bytes (key order). Writes run in the same order on both copies. Fields that
// hold each server's own clock or sign-in time are masked.
//
//   bun native/bench/compare.ts native/target/release/snowtime-axum

import { createClient } from '@libsql/client'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { buildApp, signInHeaders, startApp } from '../../perf/lib/app'
import { CACHE, COMPANY, SEED_NOW, USERS, seededDatabase } from '../../perf/lib/database'
import { companyIds } from '../../src/db/seed-company'
import { CALLS, type CallName, requestOf } from './calls'
import { startNative } from './native'

const [binary] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/compare.ts <binary>')

const DAY = 86_400_000
const organizationId = COMPANY.id

const seedDatabase = await seededDatabase()
const fixtureDirectory = mkdtempSync(join(CACHE, 'report-compare-'))
const database = join(fixtureDirectory, 'fixture.db')
cpSync(seedDatabase, database)
const fixture = createClient({ url: `file:${database}` })
try {
  const users = await fixture.execute({
    sql: 'select id from user where email = ?',
    args: [USERS.admin.email],
  })
  const userId = users.rows[0].id
  if (typeof userId !== 'string') throw new Error('Fixture owner id is not text')
  const start = Date.parse('2024-10-01T09:00:00Z')
  const descriptions = ['b', 'Á', 'A', 'á', 'a', ...Array.from({ length: 230 }, () => 'Busy day')]
  await fixture.batch(
    descriptions.map((description, i) => ({
      sql: 'insert into time_entry (id, organization_id, user_id, description, started_at, stopped_at, created_by, updated_by) values (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        `01900000-0000-7000-800f-${i.toString(16).padStart(12, '0')}`,
        organizationId,
        userId,
        description,
        start,
        start + 1000,
        userId,
        userId,
      ],
    })),
    'write',
  )
} finally {
  fixture.close()
}
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

function tokenOnly(credentials: Record<string, string>) {
  return {
    cookie: credentials.cookie
      .split('; ')
      .filter((pair) => pair.startsWith('better-auth.session_token='))
      .join('; '),
  }
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
    ...(['getSignInMethods', 'getDeployment', 'getDevUsers'] as const).flatMap((name) =>
      (['admin', 'member', null] as const).map((who): [string, CallName, unknown, Who] => [
        `${name}, ${who ?? 'signed out'}`,
        name,
        undefined,
        who,
      ]),
    ),
    ['sign-in methods ignore unknown query fields', 'getSignInMethods', { unexpected: 'x' }, null],
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
  const report = { from: reportWeek.from, to: reportWeek.to, unit: 'day' }
  const nested = { organizationId, report }
  cases.push(
    ['breakdown with tickets', 'getReportBreakdown', { ...reportWeek, tickets: true }, 'admin'],
    ['breakdown own entries, member', 'getReportBreakdown', reportWeek, 'member'],
    [
      'breakdown own filter, member',
      'getReportBreakdown',
      { ...reportWeek, userId: memberId, tickets: true },
      'member',
    ],
    ['entries by day, member', 'getReportEntries', { ...nested, view: 'day' }, 'member'],
    [
      'entries by description, member',
      'getReportEntries',
      { ...nested, view: 'description' },
      'member',
    ],
    [
      'entries own filter, member',
      'getReportEntries',
      { ...nested, report: { ...report, userId: memberId }, view: 'day' },
      'member',
    ],
    ['entry totals, member', 'getReportEntryTotals', nested, 'member'],
    [
      'entry totals own filter, member',
      'getReportEntryTotals',
      { ...nested, report: { ...report, userId: memberId } },
      'member',
    ],
    [
      'export first piece, member',
      'getReportExport',
      { ...nested, from: report.from, to: report.to },
      'member',
      now,
    ],
    [
      'export later piece, member',
      'getReportExport',
      { ...nested, from: report.from, to: report.to, now: SEED_NOW },
      'member',
    ],

    [
      'breakdown refused member',
      'getReportBreakdown',
      { ...reportWeek, userId: unknown },
      'member',
    ],
    ['entries by day', 'getReportEntries', { ...nested, view: 'day' }, 'admin'],
    ['entries by description', 'getReportEntries', { ...nested, view: 'description' }, 'admin'],
    [
      'entries remaining descriptions',
      'getReportEntries',
      { ...nested, view: 'description', offset: 25 },
      'admin',
    ],
    [
      'entries refused member',
      'getReportEntries',
      { ...nested, report: { ...report, userId: unknown }, view: 'day' },
      'member',
    ],
    ['entry totals', 'getReportEntryTotals', nested, 'admin'],
    [
      'entry totals refused member',
      'getReportEntryTotals',
      { ...nested, report: { ...report, teamId: companyIds.teams.web } },
      'member',
    ],
    [
      'export first piece',
      'getReportExport',
      { ...nested, from: report.from, to: report.to },
      'admin',
      now,
    ],
    [
      'export later piece',
      'getReportExport',
      { ...nested, from: report.from, to: report.to, now: SEED_NOW },
      'admin',
    ],
    [
      'export future now clamped',
      'getReportExport',
      { ...nested, from: report.from, to: report.to, now: new Date(SEED_NOW.getTime() + DAY) },
      'admin',
    ],
    [
      'export refused member',
      'getReportExport',
      { ...nested, report: { ...report, userId: unknown }, from: report.from, to: report.to },
      'member',
    ],
    [
      'export reversed',
      'getReportExport',
      { ...nested, from: report.to, to: report.from },
      'admin',
    ],
    [
      'export outside report',
      'getReportExport',
      { ...nested, from: '2026-09-01', to: report.to },
      'admin',
    ],
    [
      'export too long',
      'getReportExport',
      { ...nested, report: { ...report, from: '2026-08-01' }, from: '2026-08-01', to: report.to },
      'admin',
    ],
    ['entries missing view', 'getReportEntries', nested, 'admin'],
    [
      'entries fractional offset',
      'getReportEntries',
      { ...nested, view: 'description', offset: 0.5 },
      'admin',
    ],
    [
      'entries negative offset',
      'getReportEntries',
      { ...nested, view: 'description', offset: -1 },
      'admin',
    ],
  )
  for (const row of [
    { group: 'project', id: 'none' },
    { group: 'team', id: companyIds.teams.web },
    { group: 'team', id: 'none' },
    { group: 'team', id: unknown },
    { group: 'member', id: memberId },
    { group: 'ticket', id: 'none' },
    { group: 'ticket', id: 'LUM-1' },
  ]) {
    const label = JSON.stringify(row)
    cases.push(
      [`entries row ${label}`, 'getReportEntries', { ...nested, view: 'day', row }, 'admin'],
      [`totals row ${label}`, 'getReportEntryTotals', { ...nested, row }, 'admin'],
    )
  }
  const busyReport = { from: '2024-10-01', to: '2024-10-02' }
  cases.push([
    'description case and accent ties',
    'getReportEntries',
    {
      organizationId,
      report: busyReport,
      view: 'description',
    },
    'admin',
  ])
  // Follow reference cursors through ordinary days and a guaranteed three-page busy day.
  for (const range of [report, busyReport]) {
    let after: unknown
    let pages = 0
    for (;;) {
      const input = { organizationId, report: range, view: 'day', after }
      cases.push(['entries cursor page', 'getReportEntries', input, 'admin'])
      const request = requestOf(CALLS.getReportEntries, input)
      const response = await fetch(`${ts.url}${request.path}`, {
        method: 'POST',
        headers: sessions.ts.admin,
        body: request.body,
      })
      if (!response.ok) throw new Error(`Reference pagination failed: ${response.status}`)
      const page = (await response.json()) as { next: unknown }
      pages++
      if (!page.next) break
      if (pages >= 100) throw new Error('Reference pagination did not finish')
      after = page.next
    }
    if (range === busyReport && pages !== 3)
      throw new Error(`Expected three busy-day pages, got ${pages}`)
  }
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
      [`breakdown from ${label}`, 'getReportBreakdown', { ...reportWeek, from: value }, 'admin'],
      [
        `entries report ${label}`,
        'getReportEntries',
        { ...nested, report: value, view: 'day' },
        'admin',
      ],
      [`entries view ${label}`, 'getReportEntries', { ...nested, view: value }, 'admin'],
      [`entries row ${label}`, 'getReportEntries', { ...nested, view: 'day', row: value }, 'admin'],
      [
        `entries cursor ${label}`,
        'getReportEntries',
        { ...nested, view: 'day', after: value },
        'admin',
      ],
      [
        `entries offset ${label}`,
        'getReportEntries',
        { ...nested, view: 'description', offset: value },
        'admin',
      ],
      [`totals report ${label}`, 'getReportEntryTotals', { ...nested, report: value }, 'admin'],
      [
        `totals row id ${label}`,
        'getReportEntryTotals',
        { ...nested, row: { group: 'member', id: value } },
        'admin',
      ],
      [
        `export report ${label}`,
        'getReportExport',
        { ...nested, report: value, from: report.from, to: report.to },
        'admin',
      ],
      [
        `export from ${label}`,
        'getReportExport',
        { ...nested, from: value, to: report.to },
        'admin',
      ],
      [
        `export now ${label}`,
        'getReportExport',
        { ...nested, from: report.from, to: report.to, now: value },
        'admin',
        now,
      ],
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

  // Run sign-out last: each server deletes only its own session. Replay the old cookie to
  // prove that deletion, rather than browser cookie expiry alone, signs the user out.
  const signOuts: [string, Who, (server: Server) => Record<string, string>, string?][] = [
    ['sign-out, malformed JSON', 'admin', (s) => ({ origin: s.url }), '{'],
    ['sign-out, cookie without origin', 'member', () => ({})],
    ['sign-out, foreign origin', 'admin', () => ({ origin: evil })],
    ['sign-out, malformed JSON before origin', 'admin', () => ({ origin: evil }), '{'],
    [
      'sign-out, wrong types',
      'member',
      (s) => ({ origin: s.url }),
      '{"disableRedirect":"yes","state":3}',
    ],
    [
      'sign-out, foreign callback',
      'admin',
      (s) => ({ origin: s.url }),
      '{"callbackURL":"https://evil.test/x"}',
    ],
    [
      'sign-out, callback type before schema',
      'admin',
      (s) => ({ origin: s.url }),
      '{"callbackURL":3,"disableRedirect":"yes"}',
    ],
    [
      'sign-out, unsafe relative callback',
      'member',
      (s) => ({ origin: s.url }),
      '{"callbackURL":"/%2f/evil.test"}',
    ],
    ['sign-out, array body', 'admin', (s) => ({ origin: s.url }), '[]'],
    ['sign-out, null body', null, () => ({}), 'null'],
    ['sign-out, signed out', null, () => ({})],
    [
      'sign-out, invalid cookie',
      null,
      (s) => ({ origin: s.url, cookie: 'better-auth.session_token=invalid' }),
      '{}',
    ],
    [
      'sign-out, owner',
      'admin',
      (s) => ({ origin: s.url }),
      '{"callbackURL":"/sign-in","disableRedirect":true,"state":"x"}',
    ],
    ['sign-out, member and cached chunks', 'member', (s) => ({ origin: s.url }), '{}'],
  ]
  for (const [label, who, headersOf, body] of signOuts) {
    async function call(server: Server, credentials: Record<string, string>) {
      const headers = {
        ...(who
          ? { cookie: `${tokenOnly(credentials).cookie}; better-auth.session_data=cached` }
          : credentials),
        ...headersOf(server),
        'content-type': 'application/json',
      }
      if (label.includes('cached chunks')) {
        headers.cookie += '; better-auth.session_data.0=a; better-auth.session_data.1=b'
      }
      const response = await fetch(`${server.url}/api/auth/sign-out`, {
        method: 'POST',
        headers,
        body,
      })
      return {
        status: response.status,
        text: JSON.stringify({
          body: await response.text(),
          cookies: response.headers.getSetCookie(),
        }),
      }
    }
    judge(
      label,
      await call(ts, who ? sessions.ts[who] : {}),
      await call(native, who ? sessions.native[who] : {}),
    )
  }
  for (const who of ['admin', 'member'] as const) {
    async function replay(server: Server, credentials: Record<string, string>) {
      const response = await fetch(`${server.url}/api/v1/session`, {
        headers: tokenOnly(credentials),
      })
      const text = await response.text()
      if (response.status !== 200 || text !== 'null')
        throw new Error(`Sign-out did not delete ${who}'s session`)
      return { status: response.status, text }
    }
    judge(
      `session after ${who} signs out`,
      await replay(ts, sessions.ts[who]),
      await replay(native, sessions.native[who]),
    )
  }
  for (const [label, env] of [
    ['production', { NODE_ENV: 'production' }],
    ['demo', { NODE_ENV: 'production', DEMO_MODE: 'true' }],
    [
      'providers and domains',
      {
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'fixture-google',
        GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
        GITHUB_CLIENT_ID: 'fixture-github',
        GITHUB_CLIENT_SECRET: 'fixture-github-secret',
        MICROSOFT_CLIENT_ID: 'fixture-microsoft',
        MICROSOFT_CLIENT_SECRET: 'fixture-microsoft-secret',
        ALLOWED_LOGIN_DOMAINS: '@Example.com, lumen.example.com, example.com',
      },
    ],
  ] as [string, Record<string, string>][]) {
    const a = await startApp({ database, env })
    let b: Awaited<ReturnType<typeof startNative>> | undefined
    try {
      b = await startNative(binary, database, env)
      for (const name of ['getSignInMethods', 'getDeployment', 'getDevUsers'] as const) {
        async function read(server: Server) {
          const response = await fetch(`${server.url}${CALLS[name].path}`)
          return { status: response.status, text: await response.text() }
        }
        judge(`${label}, ${name}`, await read(a), await read(b))
      }
    } finally {
      await a.stop()
      await b?.stop()
    }
  }
  console.log(differences ? `${differences} calls differ` : 'Every call answers the same')
} finally {
  await Promise.all([ts.stop(), native.stop()])
  rmSync(fixtureDirectory, { recursive: true, force: true })
}
process.exit(differences ? 1 : 0)
