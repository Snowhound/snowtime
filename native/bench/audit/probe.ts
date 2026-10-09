// Task 081.30's reproductions against a native binary, each on its own copy of the
// benchmark database. Run from the repository root:
//   bun native/bench/audit/probe.ts native/target/debug/snowtime-axum [experiment...]
import { createClient } from '@libsql/client'
import { spawn, execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { freePort } from '../../../perf/lib/app'
import { CACHE, COMPANY, SEED_NOW, USERS, seededDatabase } from '../../../perf/lib/database'

const [binary, ...experiments] = process.argv.slice(2)
const WORK = join(CACHE, 'audit')
mkdirSync(WORK, { recursive: true })
const SECRET = 'perf-harness-secret-perf-harness-secret'

async function copyDb(name: string) {
  const path = join(WORK, `${name}.db`)
  for (const s of ['', '-wal', '-shm']) rmSync(path + s, { force: true })
  cpSync(await seededDatabase(), path)
  return path
}

async function start(db: string, env: Record<string, string> = {}, expectFail = false) {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  let output = ''
  const server = spawn(binary, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      PERF_NOW: String(SEED_NOW.getTime()),
      TURSO_DATABASE_URL: `file:${db}`,
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: url,
      EDGE_ACCESS_LOG: 'off',
      RENDERERS: '1',
      ...env,
    },
  })
  server.stdout.on('data', (d) => (output += d))
  server.stderr.on('data', (d) => (output += d))
  for (let waited = 0; ; waited += 100) {
    if (server.exitCode !== null) {
      if (expectFail) return { url, exited: server.exitCode, output, pid: 0, stop: async () => {} }
      throw new Error(`exited ${server.exitCode}: ${output}`)
    }
    if (
      await fetch(`${url}/api/v1/availability`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    if (waited > 15_000) throw new Error(`no answer: ${output}`)
    await Bun.sleep(100)
  }
  return {
    url,
    exited: null as number | null,
    output,
    pid: server.pid!,
    stop: async () => {
      server.kill()
      if (server.exitCode === null) await new Promise((r) => server.once('exit', r))
    },
  }
}

async function signIn(url: string, who: keyof typeof USERS = 'admin') {
  const r = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify(USERS[who]),
  })
  const cookie = r.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .join('; ')
  return { status: r.status, cookie, body: await r.text() }
}

function rssKb(pid: number) {
  return Number(execSync(`ps -o rss= -p ${pid}`).toString().trim())
}

function log(...a: unknown[]) {
  console.log(...a)
}

async function counts(db: string) {
  const c = createClient({ url: `file:${db}` })
  const tm = Number((await c.execute('select count(*) c from team_member')).rows[0].c)
  const pt = Number((await c.execute('select count(*) c from project_team')).rows[0].c)
  c.close()
  return `team_member ${tm}, project_team ${pt}`
}

const run: Record<string, () => Promise<void>> = {
  // Login-domain policy on existing sessions, and on password sign-in.
  async domains() {
    const db = await copyDb('domains')
    let app = await start(db)
    const { cookie } = await signIn(app.url)
    await app.stop()
    app = await start(db, { ALLOWED_LOGIN_DOMAINS: 'allowed.example' })
    const h = { cookie, origin: app.url }
    const timer = await fetch(`${app.url}/api/v1/timer`, { headers: h })
    log('domains: existing session GET /api/v1/timer ->', timer.status)
    const session = await fetch(`${app.url}/api/v1/session`, { headers: h })
    const s = await session.text()
    log('domains: GET /api/v1/session ->', session.status, s.slice(0, 80))
    const put = await fetch(`${app.url}/api/v1/organizations/${COMPANY.id}/projects`, {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'blocked-domain write' }),
    })
    log('domains: POST project with blocked-domain session ->', put.status)
    const fresh = await signIn(app.url)
    log('domains: password sign-in with blocked domain ->', fresh.status, fresh.body.slice(0, 80))
    await app.stop()
  },

  // Organization update with large unknown fields, followed by a concurrent write.
  async orderedjson() {
    const db = await copyDb('orderedjson')
    const app = await start(db, { RATE_LIMIT: 'off' })
    const { cookie } = await signIn(app.url)
    const h = { cookie, origin: app.url, 'content-type': 'application/json' }
    for (const n of [10_000, 25_000, 50_000, 100_000]) {
      const pad: string[] = []
      for (let i = 0; i < n; i++) pad.push(`"${i.toString(36).padStart(6, 'a')}":0`)
      const body = `{"organizationId":"${COMPANY.id}","data":{"name":"Lumen Works"},"pad":{${pad.join(',')}}}`
      const t0 = performance.now()
      const r = await fetch(`${app.url}/api/auth/organization/update`, {
        method: 'POST',
        headers: h,
        body,
      })
      await r.text()
      log(
        `orderedjson: ${n} keys, ${(body.length / 1024).toFixed(0)} KiB -> ${r.status} in ${(performance.now() - t0).toFixed(0)} ms`,
      )
    }
    // A write while a large update holds the writer.
    const pad: string[] = []
    for (let i = 0; i < 100_000; i++) pad.push(`"${i.toString(36).padStart(6, 'a')}":0`)
    const body = `{"organizationId":"${COMPANY.id}","data":{"name":"Lumen Works"},"pad":{${pad.join(',')}}}`
    const big = fetch(`${app.url}/api/auth/organization/update`, {
      method: 'POST',
      headers: h,
      body,
    })
    await Bun.sleep(10)
    const t0 = performance.now()
    const w = await fetch(`${app.url}/api/v1/settings`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ weekStart: 'mon' }),
    })
    log(
      'orderedjson: concurrent PATCH /settings ->',
      w.status,
      w.headers.get('retry-after'),
      `${(performance.now() - t0).toFixed(0)} ms`,
      (await w.text()).slice(0, 80),
    )
    await (await big).text()
    await app.stop()
  },

  // A connection that sends part of its headers and then nothing, and one kept alive after a
  // response: directly, from a listed proxy (127.0.0.1), and from an unlisted peer.
  async slowloris() {
    for (const [label, env] of [
      ['direct', {}],
      ['listed proxy', { CLIENT_IP_HEADER: 'x-client-ip', CLIENT_IP_TRUSTED_PROXIES: '127.0.0.1' }],
      [
        'unlisted peer',
        { CLIENT_IP_HEADER: 'x-client-ip', CLIENT_IP_TRUSTED_PROXIES: '192.0.2.0/24' },
      ],
    ] as [string, Record<string, string>][]) {
      const db = await copyDb('slowloris')
      const app = await start(db, env)
      const port = Number(new URL(app.url).port)
      function watch(request: string) {
        return new Promise<string>((resolve) => {
          const s = connect(port, '127.0.0.1', () => s.write(request))
          // Reads the response, so the close behind it is reported.
          s.resume()
          const t0 = Date.now()
          s.on('close', () => resolve(`closed after ${Date.now() - t0} ms`))
          s.on('error', (e) => resolve(`error ${e}`))
          setTimeout(() => {
            resolve(`still open after ${Date.now() - t0} ms`)
            s.destroy()
          }, 45_000)
        })
      }
      const [partial, idle] = await Promise.all([
        watch('GET / HTTP/1.1\r\nHost: x\r\n'),
        watch('GET /api/v1/availability HTTP/1.1\r\nHost: x\r\n\r\n'),
      ])
      log(`slowloris (${label}): partial headers ->`, partial)
      log(`slowloris (${label}): idle keep-alive after one response ->`, idle)
      await app.stop()
    }
  },

  // Rate-limit keys include the concrete path.
  async ratekeys() {
    const db = await copyDb('ratekeys')
    const app = await start(db, { RATE_LIMIT: 'on' })
    const before = rssKb(app.pid)
    const long = 'x'.repeat(30_000)
    for (let i = 0; i < 2000; i++) {
      const r = await fetch(`${app.url}/api/auth/${long}${i}`)
      await r.text()
      if (i === 0) log('ratekeys: unknown long path ->', r.status)
    }
    const after = rssKb(app.pid)
    log(
      `ratekeys: RSS ${before} KiB -> ${after} KiB after 2000 unique 30 KB paths (+${((after - before) / 1024).toFixed(1)} MiB)`,
    )
    const same = rssKb(app.pid)
    for (let i = 0; i < 2000; i++) await (await fetch(`${app.url}/api/auth/${long}`)).text()
    log(`ratekeys: control, same path 2000 times: ${same} -> ${rssKb(app.pid)} KiB`)
    await app.stop()
  },

  // Verification rows from unauthenticated calls, and their size.
  async verification() {
    const db = await copyDb('verification')
    const app = await start(db, {
      RATE_LIMIT: 'off',
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 's',
    })
    const client = createClient({ url: `file:${db}` })
    async function count() {
      return Number((await client.execute('select count(*) c from verification')).rows[0].c)
    }
    const c0 = await count()
    for (let i = 0; i < 50; i++)
      await (await fetch(`${app.url}/api/auth/passkey/generate-authenticate-options`)).text()
    log(
      `verification: rows ${c0} -> ${await count()} after 50 unauthenticated authenticate-options`,
    )
    const additional = { blob: 'y'.repeat(1_500_000) }
    const r = await fetch(`${app.url}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { origin: app.url, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/', additionalData: additional }),
    })
    await r.text()
    const max = Number(
      (await client.execute('select max(length(value)) m from verification')).rows[0].m,
    )
    log(
      `verification: unauthenticated sign-in/social with 1.5 MB additionalData -> ${r.status}; largest row ${max} bytes`,
    )
    const beforeUrl = await count()
    const urlResponse = await fetch(`${app.url}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { origin: app.url, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' + 'y'.repeat(1_500_000) }),
    })
    const urlBody = await urlResponse.json()
    const afterUrl = await count()
    log(
      `verification: unauthenticated sign-in/social with 1.5 MB callbackURL -> ${urlResponse.status}; rows ${beforeUrl} -> ${afterUrl}`,
    )
    if (urlResponse.status !== 400 || urlBody.code !== 'VALIDATION_ERROR' || afterUrl !== beforeUrl)
      throw new Error('Oversized callbackURL must refuse without storing a verification row')
    client.close()
    await app.stop()
    // Expired rows stay after a later start and a new challenge.
    const later = await start(db, { PERF_NOW: String(SEED_NOW.getTime() + 3_600_000) })
    const options = await fetch(`${later.url}/api/auth/passkey/generate-authenticate-options`)
    const challengeCookie = options.headers
      .getSetCookie()
      .map((h) => h.split(';')[0])
      .join('; ')
    await options.text()
    const c2 = createClient({ url: `file:${db}` })
    const expired = Number(
      (
        await c2.execute(
          `select count(*) c from verification where expires_at < ${SEED_NOW.getTime() + 3_600_000}`,
        )
      ).rows[0].c,
    )
    log(`verification: an hour later, expired rows still stored: ${expired}`)
    const lookup = await fetch(`${later.url}/api/auth/passkey/verify-authentication`, {
      method: 'POST',
      headers: { origin: later.url, cookie: challengeCookie, 'content-type': 'application/json' },
      body: '{"response":{}}',
    })
    await lookup.text()
    const remaining = Number((await c2.execute('select count(*) c from verification')).rows[0].c)
    log(`verification: after passkey lookup -> ${lookup.status}; total rows ${remaining}`)
    await c2.execute({
      sql: 'insert into verification(id,identifier,value,expires_at,created_at,updated_at) values (?,?,?,?,?,?)',
      args: [
        'expired-oauth-probe',
        'auth-state:expired-probe',
        '{}',
        SEED_NOW.getTime(),
        SEED_NOW.getTime(),
        SEED_NOW.getTime(),
      ],
    })
    const oauthLookup = await fetch(
      `${later.url}/api/auth/callback/google?state=missing-probe&code=bad`,
      { redirect: 'manual' },
    )
    await oauthLookup.text()
    log(
      `verification: after OAuth missing-state lookup -> ${oauthLookup.status}; total rows ${Number((await c2.execute('select count(*) c from verification')).rows[0].c)}`,
    )
    c2.close()
    await later.stop()
  },

  async errorpage() {
    const db = await copyDb('errorpage')
    const app = await start(db)
    const r = await fetch(`${app.url}/api/auth/error?error=state_not_found`)
    log('errorpage: GET /api/auth/error ->', r.status, (await r.text()).slice(0, 60))
    await app.stop()
  },

  async precompressed() {
    const db = await copyDb('precompressed')
    const dir = join(WORK, 'public')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir)
    writeFileSync(join(dir, 'backup.gz'), Bun.gzipSync(Buffer.from('secret backup contents\n')))
    const app = await start(db, { EDGE_STATIC_DIR: dir })
    const direct = await fetch(`${app.url}/backup.gz`, {
      headers: { 'accept-encoding': 'identity' },
    })
    log('precompressed: GET /backup.gz ->', direct.status)
    const r = await fetch(`${app.url}/backup`, { headers: { 'accept-encoding': 'gzip' } })
    log(
      'precompressed: GET /backup with gzip ->',
      r.status,
      r.headers.get('content-encoding'),
      JSON.stringify((await r.text()).slice(0, 40)),
    )
    await app.stop()
  },

  async secret() {
    const db = await copyDb('secret')
    const app = await start(db, { BETTER_AUTH_SECRET: 'x' }, true)
    log(
      'secret: BETTER_AUTH_SECRET=x ->',
      app.exited === null ? 'host starts and serves' : `exits ${app.exited}`,
    )
    if (app.exited === null) {
      const s = await signIn(app.url)
      log('secret: sign-in with 1-character secret ->', s.status)
    }
    await app.stop()
  },

  async renewal() {
    const db = await copyDb('renewal')
    let app = await start(db)
    const { cookie } = await signIn(app.url)
    await app.stop()
    app = await start(db, { PERF_NOW: String(SEED_NOW.getTime() + 2 * 86_400_000) })
    const r = await fetch(`${app.url}/api/v1/session`, { headers: { cookie } })
    await r.text()
    const client = createClient({ url: `file:${db}` })
    const token = decodeURIComponent(cookie.match(/session_token=([^;]+)/)![1]).split('.')[0]
    const row = (
      await client.execute({ sql: 'select expires_at from session where token = ?', args: [token] })
    ).rows[0]
    client.close()
    log(
      'renewal: two days later GET /api/v1/session ->',
      r.status,
      'set-cookie:',
      JSON.stringify(r.headers.getSetCookie()),
      'row expires',
      new Date(Number(row.expires_at)).toISOString(),
    )
    await app.stop()
  },

  // A table rebuild in the documented pattern, applied by native and by drizzle's migrator.
  async migrations() {
    const dir = join(WORK, 'migrations')
    rmSync(dir, { recursive: true, force: true })
    cpSync('drizzle', dir, { recursive: true })
    mkdirSync(join(dir, '20270101000000_rebuild_team'))
    const initial = readFileSync('drizzle/20260924113130_initial_schema/migration.sql', 'utf8')
    const teamTable = initial.match(/CREATE TABLE team \([\s\S]*?\n\);/)![0]
    const teamIndexes = initial.match(/CREATE UNIQUE INDEX [^;]+ ON team \([^;]+;/g)!
    writeFileSync(
      join(dir, '20270101000000_rebuild_team/migration.sql'),
      [
        'PRAGMA foreign_keys=OFF;',
        teamTable.replace(/^(CREATE TABLE\s+)(?:"team"|`team`|team)/i, '$1`__new_team`'),
        'INSERT INTO `__new_team` SELECT * FROM `team`;',
        'DROP TABLE `team`;',
        'ALTER TABLE `__new_team` RENAME TO `team`;',
        ...teamIndexes,
        'PRAGMA foreign_keys=ON;',
      ].join('\n--> statement-breakpoint\n'),
    )
    const nativeDb = await copyDb('migrate-native')
    log('migrations: before', await counts(nativeDb))
    const app = await start(nativeDb, { MIGRATE_ON_START: 'true', MIGRATIONS_DIR: dir })
    await app.stop()
    const nativeCounts = await counts(nativeDb)
    if (nativeCounts !== 'team_member 27, project_team 26')
      throw new Error(`valid native rebuild lost child rows: ${nativeCounts}`)
    log('migrations: after native MIGRATE_ON_START', nativeCounts)
    const tsDb = await copyDb('migrate-ts')
    const { drizzle } = await import('drizzle-orm/libsql')
    const { migrate } = await import('drizzle-orm/libsql/migrator')
    const client = createClient({ url: `file:${tsDb}` })
    await migrate(drizzle({ client }), { migrationsFolder: dir })
    client.close()
    const drizzleCounts = await counts(tsDb)
    if (drizzleCounts !== 'team_member 27, project_team 26')
      throw new Error(`valid drizzle rebuild lost child rows: ${drizzleCounts}`)
    log('migrations: after drizzle-orm libsql migrator', drizzleCounts)

    writeFileSync(
      join(dir, '20270101000000_rebuild_team/migration.sql'),
      [
        'PRAGMA foreign_keys=OFF;',
        'CREATE TABLE `__new_team` AS SELECT * FROM `team`;',
        'DROP TABLE `team`;',
        'ALTER TABLE `__new_team` RENAME TO `team`;',
        'PRAGMA foreign_keys=ON;',
      ].join('\n--> statement-breakpoint\n'),
    )
    const invalidDb = await copyDb('migrate-invalid-native')
    const before = createClient({ url: `file:${invalidDb}` })
    const previous = (await before.execute('select * from __drizzle_migrations order by id')).rows
    before.close()
    const rejected = await start(invalidDb, { MIGRATE_ON_START: 'true', MIGRATIONS_DIR: dir }, true)
    await rejected.stop()
    if (rejected.exited === null || !rejected.output.includes('foreign_key_check'))
      throw new Error(`invalid rebuild was not refused at foreign_key_check: ${rejected.output}`)
    const after = createClient({ url: `file:${invalidDb}` })
    const remaining = (await after.execute('select * from __drizzle_migrations order by id')).rows
    if ((await after.execute('PRAGMA foreign_key_check')).rows.length)
      throw new Error('invalid rebuild left foreign-key violations after rollback')
    after.close()
    if (JSON.stringify(previous) !== JSON.stringify(remaining))
      throw new Error('invalid rebuild changed the migration ledger')
    const kept = await counts(invalidDb)
    if (kept !== 'team_member 27, project_team 26')
      throw new Error(`invalid rebuild lost child rows: ${kept}`)
    log('migrations: invalid AS SELECT refused at foreign_key_check; ledger unchanged;', kept)
    const invalidTsDb = await copyDb('migrate-invalid-ts')
    const invalidClient = createClient({ url: `file:${invalidTsDb}` })
    await migrate(drizzle({ client: invalidClient }), { migrationsFolder: dir })
    invalidClient.close()
    log('migrations: invalid AS SELECT applied by drizzle;', await counts(invalidTsDb))
  },
}

for (const name of experiments.length ? experiments : Object.keys(run)) {
  try {
    await run[name]()
  } catch (e) {
    log(`${name}: FAILED`, e)
  }
}
process.exit(0)
