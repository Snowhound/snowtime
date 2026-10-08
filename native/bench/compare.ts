import { createClient } from '@libsql/client'
// Sends the same calls to the TypeScript build and a native server, each on its own copy of
// the benchmark database at SEED_NOW, and reports where the answers differ: in status, in
// content, or only in bytes (key order). Writes run in the same order on both copies. Fields that
// hold each server's own clock or sign-in time are masked.
//
//   bun native/bench/compare.ts native/target/release/snowtime-axum
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { buildApp, signInHeaders, startApp } from '../../perf/lib/app'
import { CACHE, COMPANY, SEED_NOW, USERS, seededDatabase } from '../../perf/lib/database'
import { companyIds } from '../../src/db/seed-company'
import { COLLECTION_IMAGES } from '../../src/lib/scene/images'
import { compareAuthWrites } from './auth-writes-compare'
import { CALLS, type CallName, requestOf } from './calls'
import { startNative } from './native'
import { compareOAuth } from './oauth-compare'
import { comparePasskeys } from './passkey-compare'

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
  await fixture.execute(
    "delete from user_settings where user_id = (select id from user where email = 'noah@example.com')",
  )
  const users = await fixture.execute({
    sql: 'select id from user where email = ?',
    args: [USERS.admin.email],
  })
  const userId = users.rows[0].id
  if (typeof userId !== 'string') throw new Error('Fixture owner id is not text')
  await fixture.batch(
    ['pending', 'accepted', 'rejected', 'canceled', 'pending'].map((status, i) => ({
      sql: 'insert into invitation (id,email,role,organization_id,inviter_id,status,expires_at,created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        `01900000-0000-7000-8020-${String(i).padStart(12, '0')}`,
        `preview${i}@example.com`,
        i === 0 ? 'member,admin' : null,
        organizationId,
        userId,
        status,
        SEED_NOW.getTime() + (i === 4 ? -1 : DAY),
        SEED_NOW.getTime(),
      ],
    })),
    'write',
  )
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
// TypeScript's API write limits also run in development. Enable the native switch here
// to compare those refusals; the production harness separately checks auth quotas.
const [ts, native] = await Promise.all([
  startApp({ database, env: { CLIENT_IP_HEADER: 'x-bench-ip' } }),
  startNative(binary, database, { RATE_LIMIT: 'on', CLIENT_IP_HEADER: 'x-bench-ip' }),
])

type Server = { url: string }
type Who = 'admin' | 'member' | null
interface Options {
  body?: string
  origin?: false
  // Keys whose values differ by server: its clock, or when the caller signed in.
  mask?: string[]
  captureMembership?: string
  captureMember?: string
  capture?: string
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

type WriteCase = [string, CallName, unknown, Who | 'orgAdmin', number, Options?]
async function orgAdminHeaders(server: Server) {
  const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url },
    body: JSON.stringify({ email: 'jonas@lumen.example.com', password: USERS.admin.password }),
  })
  if (!response.ok) throw new Error(`Organization admin sign-in failed: ${response.status}`)
  return {
    cookie: response.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; '),
  }
}
async function compareWrites(domain: string, cases: WriteCase[], sql: string[] = []) {
  let source = database
  if (sql.length) {
    source = join(fixtureDirectory, `${domain}.db`)
    cpSync(database, source)
    const fixture = createClient({ url: `file:${source}` })
    try {
      await fixture.batch(sql, 'write')
    } finally {
      fixture.close()
    }
  }
  const a = await startApp({ database: source })
  let b: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    b = await startNative(binary, source, { RATE_LIMIT: 'on' })
    const credentials = {
      ts: {
        admin: await signInHeaders(a, 'admin'),
        member: await signInHeaders(a, 'member'),
        orgAdmin: await orgAdminHeaders(a),
      },
      native: {
        admin: await signInHeaders(b, 'admin'),
        member: await signInHeaders(b, 'member'),
        orgAdmin: await orgAdminHeaders(b),
      },
    }
    const identities = { ts: new Map<string, string>(), native: new Map<string, string>() }
    for (const [label, name, input, who, expected, options] of cases) {
      async function call(
        server: Server,
        headers: Record<string, string>,
        ids: Map<string, string>,
      ) {
        const supplied =
          input === undefined
            ? input
            : JSON.parse(
                JSON.stringify(input, (_, value) =>
                  typeof value === 'string' ? (ids.get(value) ?? value) : value,
                ),
              )
        const route = requestOf(CALLS[name], supplied)
        const response = await fetch(`${server.url}${route.path}`, {
          method: CALLS[name].method,
          headers: {
            ...headers,
            ...(options?.origin === false ? {} : { origin: server.url }),
            'content-type': 'application/json',
          },
          body: options?.body ?? route.body,
        })
        let text = await response.text()
        if (options?.capture && response.ok) {
          const { id } = JSON.parse(text) as { id: unknown }
          if (
            typeof id !== 'string' ||
            !/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)
          )
            throw new Error(`${label}: generated id isn't UUIDv7`)
          ids.set(options.capture, id)
        }
        if (options?.captureMember && response.ok) {
          const id = JSON.parse(text).member.id
          if (
            typeof id !== 'string' ||
            !/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)
          )
            throw new Error(`${label}: member id is not UUIDv7`)
          ids.set(options.captureMember, id)
        }
        if (options?.captureMembership && response.ok) {
          const members = await (
            await fetch(`${server.url}/api/v1/organizations/${organizationId}/members`, { headers })
          ).json()
          const id = members.find(
            (member: { userId: string }) => member.userId === options.captureMembership,
          )?.memberId
          if (
            typeof id !== 'string' ||
            !/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)
          )
            throw new Error(`${label}: member id is not UUIDv7`)
          ids.set('$acceptedMember', id)
        }
        for (const [alias, id] of ids)
          text = text.replaceAll(JSON.stringify(id), JSON.stringify(alias))
        return { status: response.status, text: masked(text, options?.mask) }
      }
      const left = await call(a, who ? credentials.ts[who] : {}, identities.ts)
      const right = await call(b, who ? credentials.native[who] : {}, identities.native)
      judge(`${domain}: ${label}`, left, right)
      if (left.status !== expected || right.status !== expected)
        throw new Error(
          `${domain}: ${label}: expected ${expected}, got ${left.status}/${right.status}`,
        )
    }
  } finally {
    await a.stop()
    await b?.stop()
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
    [
      'report, upper ISO boundary',
      'getReport',
      { ...reportWeek, from: '9999-12-30', to: '9999-12-31' },
      'admin',
      now,
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
  const settingsValues = {
    timeZone: 'America/New_York',
    weekStart: 'sun',
    locale: 'et',
    theme: 'dark',
    timerLayout: 'table',
    showSummary: false,
    compactRows: true,
    wideTimer: true,
    timerView: 'calendar',
    calendarWeekend: true,
    appIcon: '12',
    sceneCollection: 'coast',
    scenePin: 'coast-june',
    sceneBackground: false,
    sceneStrength: 'full',
    surfaces: 'solid',
    sceneWeather: false,
    sceneIntro: false,
    sceneTagline: false,
    durationFormat: 'units',
    dateFormat: 'mdy',
    timeFormat: '12h',
    country: 'US',
  }
  for (const who of ['admin', 'member'] as const) {
    cases.push(
      [
        `settings PUT existing, ${who}`,
        'createSettings',
        { timeZone: 'Asia/Tokyo', locale: 'et' },
        who,
      ],
      [`settings PUT locale default, ${who}`, 'createSettings', { timeZone: 'UTC' }, who],
      [`settings PUT missing zone, ${who}`, 'createSettings', {}, who],
      [
        `settings PUT invalid zone before locale, ${who}`,
        'createSettings',
        { locale: 'bad', timeZone: 'Mars/Olympus' },
        who,
      ],
      [`settings PATCH empty, ${who}`, 'updateSettings', {}, who],
      [`settings PATCH strips unknown user id, ${who}`, 'updateSettings', { userId: unknown }, who],
      [`settings PATCH malformed JSON, ${who}`, 'updateSettings', {}, who, { body: '{' }],
      [
        `settings PATCH origin before JSON, ${who}`,
        'updateSettings',
        {},
        who,
        { origin: false, body: '{' },
      ],
      [
        `settings PATCH validation order, ${who}`,
        'updateSettings',
        { country: 'FI', timeZone: 'Mars/Olympus', locale: 'bad' },
        who,
      ],
      [
        `settings pin refuses another collection, ${who}`,
        'updateSettings',
        { scenePin: COLLECTION_IMAGES.coast[0] },
        who,
      ],
      [`settings unchanged after refusal, ${who}`, 'createSettings', { timeZone: 'UTC' }, who],
    )
    for (const field of Object.keys(settingsValues)) {
      for (const value of [null, [], 'bogus']) {
        cases.push([
          `settings ${field} = ${JSON.stringify(value)}, ${who}`,
          'updateSettings',
          { [field]: value },
          who,
        ])
      }
    }
    for (const [field, value] of Object.entries(settingsValues)) {
      cases.push([`settings valid ${field}, ${who}`, 'updateSettings', { [field]: value }, who])
    }
    cases.push(
      [
        `settings saved collection rejects pin, ${who}`,
        'updateSettings',
        { scenePin: 'autumn' },
        who,
      ],
      [
        `settings clears pin on collection selection, ${who}`,
        'updateSettings',
        { sceneCollection: 'mountains' },
        who,
      ],
      [
        `settings explicit null pin and country, ${who}`,
        'updateSettings',
        { scenePin: null, country: null },
        who,
      ],
      [`settings boolean string revival, ${who}`, 'updateSettings', { showSummary: 'true' }, who],
      [`settings no-op retains all fields, ${who}`, 'updateSettings', {}, who],
    )
  }
  for (const [i, timeZone] of [
    'UTC',
    'utc',
    'US/Eastern',
    'Etc/GMT+2',
    'America/Argentina/Buenos_Aires',
    '+02:00',
    '',
    'Factory',
    'Z',
    'UTC\n',
    'Europe/Tallinn; DROP',
  ].entries()) {
    cases.push([
      `settings PUT zone ${JSON.stringify(timeZone)}`,
      'createSettings',
      { timeZone },
      i % 2 === 0 ? 'member' : 'admin',
    ])
  }
  cases.push(
    ['settings PUT signed out', 'createSettings', { timeZone: 'UTC' }, null],
    ['settings PATCH signed out', 'updateSettings', { weekStart: 'sun' }, null],
    ['settings session before JSON', 'updateSettings', {}, null, { body: '{' }],
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
      if (label.startsWith('settings') && response.status === 429)
        throw new Error(`Settings case hit the write limit: ${label}`)
      return { status: response.status, text: masked(await response.text(), options?.mask) }
    }
    judge(
      label,
      await call(ts, who ? sessions.ts[who] : {}),
      await call(native, who ? sessions.native[who] : {}),
    )
  }

  async function freshSettingsHeaders(server: Server) {
    const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: server.url, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'noah@example.com', password: USERS.member.password }),
    })
    if (!response.ok) throw new Error('Fresh-settings user could not sign in')
    return {
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    }
  }
  const fresh = { ts: await freshSettingsHeaders(ts), native: await freshSettingsHeaders(native) }
  for (const [label, name, input, expected] of [
    ['empty patch before creation', 'updateSettings', {}, 404],
    ['patch before creation', 'updateSettings', { weekStart: 'sun' }, 404],
    ['wrong collection before missing settings', 'updateSettings', { scenePin: 'coast-june' }, 422],
    ['valid pin before missing settings', 'updateSettings', { scenePin: 'autumn' }, 404],
    ['invalid PUT before creation', 'createSettings', { timeZone: '+02:00' }, 400],
    ['first PUT with default locale', 'createSettings', { timeZone: 'Asia/Tokyo' }, 200],
    ['second PUT ignores input', 'createSettings', { timeZone: 'Europe/Paris', locale: 'et' }, 200],
    ['new settings patch', 'updateSettings', { scenePin: 'autumn', country: 'EE' }, 200],
    ['new settings selects collection', 'updateSettings', { sceneCollection: 'coast' }, 200],
    ['new settings no-op', 'updateSettings', {}, 200],
  ] as [string, 'createSettings' | 'updateSettings', unknown, number][]) {
    async function call(server: Server, credentials: Record<string, string>) {
      const request = requestOf(CALLS[name], input)
      const response = await fetch(`${server.url}${request.path}`, {
        method: CALLS[name].method,
        headers: { ...credentials, origin: server.url, 'content-type': 'application/json' },
        body: request.body,
      })
      if (response.status !== expected)
        throw new Error(`${label} returned ${response.status}, expected ${expected}`)
      return { status: response.status, text: await response.text() }
    }
    judge(
      `settings fresh user, ${label}`,
      await call(ts, fresh.ts),
      await call(native, fresh.native),
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
    ...[64, 65].map((length): [string, (server: Server) => Record<string, string>, string] => [
      `sign-in, ${length} astral password characters`,
      (s) => ({ origin: s.url }),
      JSON.stringify({ email: USERS.admin.email, password: '😀'.repeat(length) }),
    ]),
    ['sign-in, invalid email', (s) => ({ origin: s.url }), '{"email":"x","password":"y"}'],
  ]
  for (const [index, [label, headersOf, body]] of signIns.entries()) {
    async function call(server: Server) {
      const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
        method: 'POST',
        // Each origin/schema case needs an unspent auth bucket.
        headers: {
          'content-type': 'application/json',
          'x-bench-ip': `203.0.113.${index + 1}`,
          ...headersOf(server),
        },
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
      const headers: Record<string, string> = {
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
  const projectId = '01900000-0000-7000-8010-000000000001'
  const duplicateId = '01900000-0000-7000-8010-000000000002'
  const project = { organizationId, id: projectId }
  const assigned = { organizationId, projectId, teamId: companyIds.teams.design }
  const projectCases: WriteCase[] = []
  for (const [name, input] of [
    ['createProject', { ...project, name: 'Functional project' }],
    ['updateProject', { ...project, name: 'Renamed' }],
    ['archiveProject', project],
    ['unarchiveProject', project],
    ['deleteProject', project],
    ['assignProjectToTeam', assigned],
    ['unassignProjectFromTeam', assigned],
  ] as [CallName, unknown][]) {
    projectCases.push(
      [`${name} member refusal`, name, input, 'member', 403],
      [`${name} signed out`, name, input, null, 401],
      [`${name} malformed body`, name, input, 'admin', 400, { body: '{' }],
    )
  }
  for (const value of [undefined, null, 3, [], '', ' ', 'x'.repeat(101), '😀'.repeat(51)]) {
    projectCases.push([
      `create name ${JSON.stringify(value)}`,
      'createProject',
      { ...project, name: value },
      'admin',
      400,
    ])
  }
  for (const value of [3, [], '#123', '#gggggg', ' #112233']) {
    projectCases.push([
      `create color ${JSON.stringify(value)}`,
      'createProject',
      { ...project, name: 'Valid', color: value },
      'admin',
      400,
    ])
  }
  projectCases.push(
    [
      'create trims name and defaults color',
      'createProject',
      { ...project, name: '\ufeff Functional project ' },
      'admin',
      200,
    ],
    ['id conflict', 'createProject', { ...project, name: 'Other name' }, 'admin', 409],
    [
      'name conflict',
      'createProject',
      { ...project, id: duplicateId, name: 'Functional project' },
      'admin',
      409,
    ],
    [
      'create second project',
      'createProject',
      { ...project, id: duplicateId, name: 'Other name', color: '#aBcDeF' },
      'admin',
      200,
    ],
    ['update name conflict', 'updateProject', { ...project, name: 'Other name' }, 'admin', 409],
    ['update name', 'updateProject', { ...project, name: ' Renamed ' }, 'admin', 200],
    ['update color', 'updateProject', { ...project, color: '#112233' }, 'admin', 200],
    ['update clears color', 'updateProject', { ...project, color: null }, 'admin', 200],
    ['update empty', 'updateProject', project, 'admin', 200],
    ['archive', 'archiveProject', project, 'admin', 200, { mask: ['archivedAt'] }],
    ['repeat archive', 'archiveProject', project, 'admin', 200, { mask: ['archivedAt'] }],
    [
      'rename archived',
      'updateProject',
      { ...project, name: 'Archived rename' },
      'admin',
      200,
      { mask: ['archivedAt'] },
    ],
    ['unarchive', 'unarchiveProject', project, 'admin', 200],
    ['repeat unarchive', 'unarchiveProject', project, 'admin', 200],
    ['assign', 'assignProjectToTeam', assigned, 'admin', 200],
    ['repeat assign', 'assignProjectToTeam', assigned, 'admin', 200],
    ['member visibility after assignment', 'listProjects', { organizationId }, 'member', 200],
    ['missing team', 'assignProjectToTeam', { ...assigned, teamId: unknown }, 'admin', 404],
    [
      'missing project checked first',
      'assignProjectToTeam',
      { ...assigned, projectId: unknown, teamId: unknown },
      'admin',
      404,
    ],
    ['unassign', 'unassignProjectFromTeam', assigned, 'admin', 200],
    ['repeat unassign', 'unassignProjectFromTeam', assigned, 'admin', 200],
    ['reassign before delete', 'assignProjectToTeam', assigned, 'admin', 200],
    ['delete removes assignments', 'deleteProject', project, 'admin', 200],
    ['repeat delete', 'deleteProject', project, 'admin', 404],
    [
      'reuse deleted name',
      'createProject',
      { ...project, id: '01900000-0000-7000-8010-000000000003', name: 'Archived rename' },
      'admin',
      200,
    ],
    [
      'used project refuses delete',
      'deleteProject',
      { organizationId, id: '01900000-0000-7000-8001-000000003000' },
      'admin',
      409,
    ],
  )
  for (const name of [
    'updateProject',
    'archiveProject',
    'unarchiveProject',
    'deleteProject',
  ] as const) {
    projectCases.push(
      [`${name} missing`, name, { organizationId, id: unknown, name: 'X' }, 'admin', 404],
      [`${name} invalid id`, name, { organizationId, id: 'bad', name: 'X' }, 'admin', 400],
    )
  }
  await compareWrites('projects', projectCases)
  await compareWrites(
    'project limit',
    [
      [
        'owner at limit',
        'createProject',
        { organizationId, id: unknown, name: 'New' },
        'admin',
        422,
      ],
      [
        'member permission before limit',
        'createProject',
        { organizationId, id: unknown, name: 'New' },
        'member',
        403,
      ],
    ],
    [
      `with recursive n(x) as (select 1 union all select x+1 from n where x<1000) insert into project (id,organization_id,name,created_by,updated_by) select 'limit-project-'||x,'${organizationId}','Limit project '||x,(select user_id from member where organization_id='${organizationId}' and role='owner' limit 1),(select user_id from member where organization_id='${organizationId}' and role='owner' limit 1) from n`,
    ],
  )
  const team = { organizationId, teamId: '$functionalTeam' }
  const membership = { ...team, userId: memberId }
  const teamCases: WriteCase[] = []
  for (const [name, input] of [
    ['createTeam', { organizationId, name: 'Functional team' }],
    ['renameTeam', { organizationId, teamId: companyIds.teams.design, name: 'Renamed' }],
    ['deleteTeam', { organizationId, teamId: companyIds.teams.design }],
    ['addTeamMember', { organizationId, teamId: companyIds.teams.design, userId: memberId }],
    ['removeTeamMember', { organizationId, teamId: companyIds.teams.design, userId: memberId }],
    [
      'setTeamRole',
      { organizationId, teamId: companyIds.teams.design, userId: memberId, role: 'lead' },
    ],
  ] as [CallName, unknown][]) {
    teamCases.push(
      [`${name} member refusal`, name, input, 'member', 403],
      [`${name} signed out`, name, input, null, 401],
      [`${name} malformed JSON`, name, input, 'admin', 400, { body: '{' }],
    )
  }
  for (const value of [undefined, null, 3, [], '', ' ', 'x'.repeat(101), '😀'.repeat(51)]) {
    teamCases.push([
      `create name ${JSON.stringify(value)}`,
      'createTeam',
      { organizationId, name: value },
      'admin',
      400,
    ])
  }
  teamCases.push(
    [
      'create and trim',
      'createTeam',
      { organizationId, name: ' Functional team ' },
      'admin',
      200,
      { capture: '$functionalTeam' },
    ],
    ['name conflict', 'createTeam', { organizationId, name: 'Functional team' }, 'orgAdmin', 409],
    ['rename conflict', 'renameTeam', { ...team, name: 'Design' }, 'admin', 409],
    ['rename', 'renameTeam', { ...team, name: 'Renamed functional team' }, 'orgAdmin', 200],
    ['add member', 'addTeamMember', membership, 'orgAdmin', 200],
    ['repeat add', 'addTeamMember', membership, 'admin', 200],
    ['promote to lead', 'setTeamRole', { ...membership, role: 'lead' }, 'orgAdmin', 200],
    ['repeat add preserves lead', 'addTeamMember', membership, 'admin', 200],
    ['roles in team list', 'listTeams', { organizationId }, 'member', 200],
    ['roles in member list', 'listMembers', { organizationId }, 'member', 200],
    ['return to member', 'setTeamRole', { ...membership, role: 'member' }, 'admin', 200],
    ['unknown member', 'addTeamMember', { ...team, userId: unknown }, 'admin', 404],
    [
      'missing team before member',
      'addTeamMember',
      { organizationId, teamId: unknown, userId: unknown },
      'admin',
      404,
    ],
    [
      'missing membership role',
      'setTeamRole',
      { ...team, userId: unknown, role: 'lead' },
      'admin',
      404,
    ],
    ['remove member', 'removeTeamMember', membership, 'orgAdmin', 200],
    ['repeat remove', 'removeTeamMember', membership, 'admin', 404],
    ['delete', 'deleteTeam', team, 'orgAdmin', 200],
    ['repeat delete', 'deleteTeam', team, 'admin', 404],
    [
      'create as organization admin',
      'createTeam',
      { organizationId, name: 'Admin team' },
      'orgAdmin',
      200,
      { capture: '$adminTeam' },
    ],
    ['delete as owner', 'deleteTeam', { organizationId, teamId: '$adminTeam' }, 'admin', 200],
    ['list after deletion', 'listTeams', { organizationId }, 'member', 200],
  )
  for (const role of [undefined, null, [], 'owner', 'Lead'])
    teamCases.push([
      `invalid role ${JSON.stringify(role)}`,
      'setTeamRole',
      { organizationId, teamId: companyIds.teams.design, userId: memberId, role },
      'admin',
      400,
    ])
  for (const name of [
    'renameTeam',
    'deleteTeam',
    'addTeamMember',
    'removeTeamMember',
    'setTeamRole',
  ] as const) {
    teamCases.push(
      [
        `${name} unknown team`,
        name,
        { organizationId, teamId: unknown, userId: memberId, role: 'lead', name: 'X' },
        'admin',
        404,
      ],
      [
        `${name} bad team id`,
        name,
        { organizationId, teamId: 'bad', userId: memberId, role: 'lead', name: 'X' },
        'admin',
        400,
      ],
    )
  }
  await compareWrites('teams', teamCases)
  await compareWrites(
    'team limit',
    [
      ['owner at limit', 'createTeam', { organizationId, name: 'New' }, 'admin', 422],
      [
        'member permission before limit',
        'createTeam',
        { organizationId, name: 'New' },
        'member',
        403,
      ],
    ],
    [
      `with recursive n(x) as (select 1 union all select x+1 from n where x<100) insert into team (id,organization_id,name,created_at) select 'limit-team-'||x,'${organizationId}','Limit team '||x,0 from n`,
    ],
  )
  const invitationCases: WriteCase[] = [
    ['list as owner', 'listInvitations', { organizationId }, 'admin', 200],
    ['list as member', 'listInvitations', { organizationId }, 'member', 200],
    ['list signed out', 'listInvitations', { organizationId }, null, 401],
    ['unknown preview signed out', 'getInvitation', { id: unknown }, null, 200],
    ['invalid preview id', 'getInvitation', { id: 'bad' }, null, 400],
    [
      'member refusal',
      'inviteMember',
      { organizationId, email: 'functional@example.com', role: 'member', teamId: null },
      'member',
      403,
    ],
    [
      'signed out',
      'inviteMember',
      { organizationId, email: 'functional@example.com', role: 'member', teamId: null },
      null,
      401,
    ],
    ['malformed body', 'inviteMember', { organizationId }, 'admin', 400, { body: '{' }],
    [
      'missing team',
      'inviteMember',
      { organizationId, email: 'functional@example.com', role: 'member', teamId: unknown },
      'admin',
      404,
    ],
    [
      'existing member',
      'inviteMember',
      { organizationId, email: USERS.member.email, role: 'member', teamId: null },
      'admin',
      400,
    ],
    [
      'admin cannot invite owner',
      'inviteMember',
      { organizationId, email: 'new-owner@example.com', role: 'owner', teamId: null },
      'orgAdmin',
      403,
    ],
  ]
  for (let i = 0; i < 5; i++)
    invitationCases.push([
      `preview state ${i}`,
      'getInvitation',
      { id: `01900000-0000-7000-8020-${String(i).padStart(12, '0')}` },
      null,
      200,
    ])
  for (const value of [
    undefined,
    null,
    3,
    [],
    '',
    'bad',
    'a..b@example.com',
    'user@localhost',
    'ä@example.com',
  ]) {
    invitationCases.push([
      `invalid email ${JSON.stringify(value)}`,
      'inviteMember',
      { organizationId, email: value, role: 'member', teamId: null },
      'admin',
      400,
    ])
  }
  for (const [field, value] of [
    ['role', undefined],
    ['role', null],
    ['role', 'lead'],
    ['role', []],
    ['teamId', undefined],
    ['teamId', 'bad'],
    ['teamId', 3],
  ] as [string, unknown][]) {
    invitationCases.push([
      `invalid ${field} ${JSON.stringify(value)}`,
      'inviteMember',
      { organizationId, email: 'valid@example.com', role: 'member', teamId: null, [field]: value },
      'admin',
      400,
    ])
  }
  invitationCases.push(
    [
      'Valibot email then Zod refusal',
      'inviteMember',
      { organizationId, email: 'valid@part.123.example.com', role: 'member', teamId: null },
      'admin',
      200,
      { capture: '$numericDomain', mask: ['expiresAt'] },
    ],
    [
      'create and normalize email',
      'inviteMember',
      {
        organizationId,
        email: ' Functional@EXAMPLE.COM ',
        role: 'member',
        teamId: companyIds.teams.design,
      },
      'admin',
      200,
      { capture: '$functionalInvite', mask: ['expiresAt'] },
    ],
    [
      'duplicate open invitation',
      'inviteMember',
      { organizationId, email: 'functional@example.com', role: 'admin', teamId: null },
      'admin',
      400,
    ],
    ['preview has team and inviter', 'getInvitation', { id: '$functionalInvite' }, null, 200],
    [
      'list after create as member',
      'listInvitations',
      { organizationId },
      'member',
      200,
      { mask: ['expiresAt'] },
    ],
    [
      'organization admin can invite admin',
      'inviteMember',
      { organizationId, email: 'another-admin@example.com', role: 'admin', teamId: null },
      'orgAdmin',
      200,
      { capture: '$adminInvite', mask: ['expiresAt'] },
    ],
    [
      'owner can invite owner',
      'inviteMember',
      { organizationId, email: 'another-owner@example.com', role: 'owner', teamId: null },
      'admin',
      200,
      { capture: '$ownerInvite', mask: ['expiresAt'] },
    ],
  )
  await compareWrites('invitations', invitationCases)
  const invitationRates: WriteCase[] = []
  for (const who of ['admin', 'member'] as const) {
    for (let i = 0; i < 31; i++)
      invitationRates.push([
        `${who} invitation request ${i + 1}`,
        'inviteMember',
        { organizationId, email: USERS.member.email, role: 'member', teamId: null },
        who,
        i === 30 ? 429 : who === 'admin' ? 400 : 403,
      ])
  }
  await compareWrites('invitation rate', invitationRates)
  const issueCases: WriteCase[] = [
    [
      'member refused',
      'updateIssueLinks',
      { organizationId, issueLinks: 'https://tracker.example.com/{key}' },
      'member',
      403,
    ],
    ['signed out', 'updateIssueLinks', { organizationId, issueLinks: '' }, null, 401],
    ['malformed JSON', 'updateIssueLinks', { organizationId }, 'admin', 400, { body: '{' }],
  ]
  for (const value of [
    undefined,
    null,
    3,
    [],
    'http://example.com/{key}',
    'https://localhost/{key}',
    'https://example.com',
    'https://example.com/',
    'https://example.com/a b/{key}',
    'x'.repeat(501),
  ]) {
    issueCases.push([
      `invalid ${JSON.stringify(value)}`,
      'updateIssueLinks',
      { organizationId, issueLinks: value },
      'admin',
      400,
    ])
  }
  issueCases.push(
    [
      'set and trim as owner',
      'updateIssueLinks',
      { organizationId, issueLinks: ' https://tracker.example.com/browse/{key} ' },
      'admin',
      200,
    ],
    [
      'session exposes saved links',
      'getAppSession',
      undefined,
      'admin',
      200,
      { mask: ['signedInAt', 'appUrl'] },
    ],
    [
      'set as organization admin',
      'updateIssueLinks',
      { organizationId, issueLinks: 'https://other.example.com/{key}' },
      'orgAdmin',
      200,
    ],
    ['clear links', 'updateIssueLinks', { organizationId, issueLinks: ' \ufeff ' }, 'admin', 200],
    [
      'session exposes cleared links',
      'getAppSession',
      undefined,
      'member',
      200,
      { mask: ['signedInAt', 'appUrl'] },
    ],
  )
  await compareWrites('issue links', issueCases)
  await compareWrites(
    'invitation limit',
    [
      [
        'owner at limit',
        'inviteMember',
        { organizationId, email: 'limit-new@example.com', role: 'member', teamId: null },
        'admin',
        403,
      ],
      [
        'member permission before limit',
        'inviteMember',
        { organizationId, email: 'limit-new@example.com', role: 'member', teamId: null },
        'member',
        403,
      ],
      [
        'existing member before limit',
        'inviteMember',
        { organizationId, email: USERS.member.email, role: 'member', teamId: null },
        'admin',
        400,
      ],
    ],
    [
      `with recursive n(x) as (select 1 union all select x+1 from n where x<100) insert into invitation (id,email,organization_id,inviter_id,status,expires_at,created_at) select 'limit-invite-'||x,'limit'||x||'@example.com','${organizationId}',(select user_id from member where organization_id='${organizationId}' and role='owner' limit 1),'pending',${SEED_NOW.getTime() + DAY},0 from n`,
    ],
  )
  const acceptId = '01900000-0000-7000-8030-000000000001'
  function acceptanceFixture(
    email: string,
    status = 'pending',
    expires = SEED_NOW.getTime() + DAY,
  ) {
    return `insert into invitation (id,email,role,organization_id,inviter_id,status,expires_at,created_at,team_id) values ('${acceptId}','${email}','admin','${organizationId}',(select id from user where email='${USERS.admin.email}'),'${status}',${expires},0,'${companyIds.teams.design}')`
  }
  for (const name of ['acceptInvitation', 'authAcceptInvitation'] as const) {
    const input = name === 'acceptInvitation' ? { id: acceptId } : { invitationId: acceptId }
    const closed = name === 'acceptInvitation' ? { id: unknown } : { invitationId: unknown }
    await compareWrites(
      `${name} refusals`,
      [
        ['wrong recipient', name, input, 'member', 403],
        ['unknown invitation', name, closed, 'admin', 400],
        ['signed out', name, input, null, 401],
        ['malformed JSON', name, input, 'admin', 400, { body: '{' }],
        ['origin refusal', name, input, 'admin', 403, { origin: false }],
        ['refusals preserve pending state', 'getInvitation', { id: acceptId }, null, 200],
      ],
      [acceptanceFixture(USERS.admin.email)],
    )
    for (const [label, status, expires] of [
      ['expired', 'pending', SEED_NOW.getTime() - 1000],
      ['canceled', 'canceled', SEED_NOW.getTime() + DAY],
      ['accepted', 'accepted', SEED_NOW.getTime() + DAY],
    ] as const)
      await compareWrites(
        `${name} ${label}`,
        [
          [label, name, input, 'admin', 400],
          ['preview unchanged', 'getInvitation', { id: acceptId }, null, 200],
        ],
        [acceptanceFixture(USERS.admin.email, status, expires)],
      )
    await compareWrites(
      `${name} existing member`,
      [
        ['reuse owner without demotion', name, input, 'admin', 200],
        ['closed preview', 'getInvitation', { id: acceptId }, null, 200],
        ['repeat refuses', name, input, 'admin', 400],
        ['roles and counts', 'listMembers', { organizationId }, 'admin', 200],
        ['team assignment', 'listTeams', { organizationId }, 'admin', 200],
        [
          'active organization',
          'getAppSession',
          undefined,
          'admin',
          200,
          { mask: ['signedInAt', 'appUrl'] },
        ],
      ],
      [acceptanceFixture(USERS.admin.email)],
    )
    const newInput = name === 'acceptInvitation' ? { id: acceptId } : { invitationId: acceptId }
    await compareWrites(
      `${name} new member`,
      [
        [
          'accept adds member',
          name,
          newInput,
          'member',
          200,
          name === 'authAcceptInvitation'
            ? { captureMember: '$acceptedMember', mask: ['createdAt'] }
            : { captureMembership: memberId },
        ],
        ['closed preview', 'getInvitation', { id: acceptId }, null, 200],
        ['member role', 'listMembers', { organizationId }, 'member', 200, { mask: ['joinedAt'] }],
        ['team assignment', 'listTeams', { organizationId }, 'member', 200],
        ['repeat refuses', name, newInput, 'member', 400],
        [
          'active organization',
          'getAppSession',
          undefined,
          'member',
          200,
          { mask: ['signedInAt', 'appUrl'] },
        ],
      ],
      [
        `delete from team_member where user_id='${memberId}' and team_id in (select id from team where organization_id='${organizationId}')`,
        `update team set member_count=(select count(*) from team_member where team_id=team.id) where organization_id='${organizationId}'`,
        `delete from member where user_id='${memberId}' and organization_id='${organizationId}'`,
        acceptanceFixture(USERS.member.email),
      ],
    )
  }
  for (const value of [undefined, null, 3, [], {}, true])
    await compareWrites(`auth acceptance schema ${JSON.stringify(value)}`, [
      ['Zod string', 'authAcceptInvitation', { invitationId: value }, 'admin', 400],
    ])
  await comparePasskeys(binary, database, judge)
  await compareOAuth(binary, database, judge)
  await compareAuthWrites(binary, database, judge)
  console.log(differences ? `${differences} calls differ` : 'Every call answers the same')
} finally {
  await Promise.all([ts.stop(), native.stop()])
  rmSync(fixtureDirectory, { recursive: true, force: true })
}
process.exit(differences ? 1 : 0)
