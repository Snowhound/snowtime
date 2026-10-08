// Renders the same pages on two native hosts, one after the other on one copy of the
// benchmark database with the same sessions, and compares each answer byte for byte. Only the
// CSP nonce, which is random per page, times from the host's clock, and the Date and
// Server-Timing headers are masked. A
// change to the render crate, the bundle, or the in-process API transport must not change a
// page; compare.ts and conformance cover only the API.
//
//   bun native/bench/page-compare.ts <control-binary> <candidate-binary>
import { createClient } from '@libsql/client'
import { spawn } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { freePort } from '../../perf/lib/app'
import { CACHE, SEED_NOW, USERS, seededDatabase } from '../../perf/lib/database'

const [control, candidate] = process.argv.slice(2)
if (!control || !candidate) {
  console.error('page-compare.ts <control-binary> <candidate-binary>')
  process.exit(2)
}

const PATHS = [
  '/',
  '/sign-in',
  '/privacy',
  '/terms',
  '/create-organization',
  '/invitation/unknown',
  '/lumen',
  '/lumen/timer',
  '/lumen/projects',
  '/lumen/organization',
  '/lumen/settings',
  '/lumen/reports',
  '/lumen/reports?range=this-week',
  '/lumen/reports?range=this-month',
  '/lumen/reports?range=custom&from=2026-01-01&to=2026-09-30',
  '/lumen/reports?range=custom&from=2026-09-30&to=2026-01-01',
  '/lumen/unknown',
  '/nowhere/timer',
]

type Who = 'admin' | 'member' | null
type Case = { who: Who; path: string; headers?: Record<string, string>; method?: string }
const cases: Case[] = []
for (const who of ['admin', 'member', null] as Who[])
  for (const path of PATHS) cases.push({ who, path })
cases.push({ who: 'admin', path: '/lumen/timer', headers: { 'accept-language': 'et' } })
cases.push({ who: 'admin', path: '/lumen/reports', headers: { cookie: 'PARAGLIDE_LOCALE=et' } })
cases.push({ who: 'admin', path: '/lumen/timer', method: 'HEAD' })
cases.push({ who: 'admin', path: '/lumen/timer', method: 'POST' })
// The page's own request headers mustn't reach its API calls.
cases.push({
  who: 'admin',
  path: '/lumen/timer',
  headers: { origin: 'https://elsewhere.example', 'x-forwarded-for': '203.0.113.9' },
})

const ORIGIN = 'http://snowtime.test'

const database = join(CACHE, `pages-${process.pid}.db`)
cpSync(await seededDatabase(), database)
const fixture = createClient({ url: `file:${database}` })
await fixture.execute(
  'update user_settings set scene_intro = 0, scene_background = 0, scene_weather = 0',
)
fixture.close()

async function start(binary: string) {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const server = spawn(binary, [], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      PERF_NOW: String(SEED_NOW.getTime()),
      TURSO_DATABASE_URL: `file:${database}`,
      BETTER_AUTH_SECRET: 'perf-harness-secret-perf-harness-secret',
      // One origin for both hosts, so absolute URLs in the pages match.
      BETTER_AUTH_URL: ORIGIN,
      EDGE_ACCESS_LOG: 'off',
    },
  })
  for (let waited = 0; ; waited += 100) {
    if (server.exitCode !== null) throw new Error(`${binary} exited ${server.exitCode}`)
    const up = await fetch(`${url}/api/v1/availability`).then(
      (r) => r.ok,
      () => false,
    )
    if (up) break
    if (waited > 10_000) throw new Error(`${binary} didn't answer in 10 s`)
    await Bun.sleep(100)
  }
  return {
    url,
    stop: async () => {
      server.kill()
      if (server.exitCode === null) await new Promise((resolve) => server.once('exit', resolve))
    },
  }
}

async function signIn(url: string, who: keyof typeof USERS) {
  const response = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(USERS[who]),
  })
  if (!response.ok) throw new Error(`Sign-in as ${who}: ${response.status}`)
  return response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ')
}

// The router and the query cache stamp a page with the host's clock, which runs on from
// PERF_NOW; seeded data is older.
function fromClock(time: number) {
  return time >= SEED_NOW.getTime() && time < SEED_NOW.getTime() + 3_600_000
}

type Answer = { status: number; headers: string; body: string }

async function render(url: string, sessions: Record<string, string>, item: Case) {
  const headers: Record<string, string> = { ...item.headers }
  const session = item.who ? sessions[item.who] : undefined
  if (session) headers.cookie = [session, headers.cookie].filter(Boolean).join('; ')
  const response = await fetch(url + item.path, {
    method: item.method ?? 'GET',
    headers,
    redirect: 'manual',
  })
  const nonce = /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1]
  function mask(text: string) {
    return (nonce ? text.replaceAll(nonce, '$nonce') : text)
      .replace(/\b\d{13}\b/g, (n) => (fromClock(Number(n)) ? '$now' : n))
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, (iso) =>
        fromClock(Date.parse(iso)) ? '$now' : iso,
      )
  }
  const kept = [...response.headers].filter(([name]) => !['date', 'server-timing'].includes(name))
  return {
    status: response.status,
    headers: mask(JSON.stringify(kept)),
    body: mask(await response.text()),
  }
}

async function run(binary: string, sessions: Record<string, string> | undefined) {
  const host = await start(binary)
  try {
    sessions ??= {
      admin: await signIn(host.url, 'admin'),
      member: await signIn(host.url, 'member'),
    }
    const answers: Answer[] = []
    for (const item of cases) answers.push(await render(host.url, sessions, item))
    return { sessions, answers }
  } finally {
    await host.stop()
  }
}

let differences = 0
try {
  const before = await run(control, undefined)
  const after = await run(candidate, before.sessions)
  for (const [i, item] of cases.entries()) {
    const a = before.answers[i]
    const b = after.answers[i]
    if (!a || !b) throw new Error(`No answer for ${item.path}`)
    const same = a.status === b.status && a.headers === b.headers && a.body === b.body
    if (!same) differences++
    const label = `${item.method ?? 'GET'} ${item.path} as ${item.who ?? 'nobody'}`
    const extra = item.headers ? ` with ${JSON.stringify(item.headers)}` : ''
    console.log(
      `${same ? 'same bytes' : 'DIFFERENT '} ${label}${extra} (${a.status}, ${a.body.length} bytes)`,
    )
    if (same) continue
    if (a.status !== b.status) console.log(`  status ${a.status} -> ${b.status}`)
    if (a.headers !== b.headers) console.log(`  headers ${a.headers}\n       -> ${b.headers}`)
    if (a.body !== b.body) {
      let at = 0
      while (a.body[at] === b.body[at]) at++
      console.log(`  body at ${at}: ${a.body.slice(at - 80, at + 120)}`)
      console.log(`       -> ${b.body.slice(at - 80, at + 120)}`)
    }
  }
  console.log(`${cases.length} pages, ${cases.length - differences} byte-equal`)
} finally {
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(database + suffix, { force: true })
}
process.exit(differences ? 1 : 0)
