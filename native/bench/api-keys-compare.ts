// Compares personal API keys (docs/api.md): the calls a key makes and Settings' calls with
// the session, on fixture keys in both servers' copies of the database, then the rows each
// server writes for a new key, column by column, and each server's key on the other server.
import { createClient } from '@libsql/client'
import { createHash } from 'node:crypto'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { signInHeaders, startApp } from '../../perf/lib/app'
import { CACHE, COMPANY, SEED_NOW, USERS } from '../../perf/lib/database'
import { CALLS, type CallName, requestOf } from './calls'
import { startNative } from './native'

type Observation = { label: string; status: number; expected: number; text: string }
type Server = { url: string }

function hashKey(key: string) {
  return createHash('sha256').update(key).digest('base64url')
}
function fixtureKey(name: string) {
  return `snow_${name.padEnd(64, 'x')}`
}
const KEYS = {
  read: fixtureKey('read'),
  write: fixtureKey('write'),
  expired: fixtureKey('expired'),
  disabled: fixtureKey('disabled'),
  rate: fixtureKey('rate'),
  admin: fixtureKey('admin'),
}
const READ = '{"api":["read"]}'
const WRITE = '{"api":["read","write"]}'

async function fixtureDatabase(database: string) {
  const path = join(CACHE, 'api-keys-compare.db')
  cpSync(database, path)
  const db = createClient({ url: `file:${path}` })
  try {
    async function idOf(email: string) {
      const { rows } = await db.execute({
        sql: 'select id from user where email = ?',
        args: [email],
      })
      const id = rows[0]?.id
      if (typeof id !== 'string') throw new Error(`api keys: no user ${email}`)
      return id
    }
    const member = await idOf(USERS.member.email)
    const admin = await idOf(USERS.admin.email)
    const rows: [keyof typeof KEYS, string, string, number | null, number][] = [
      ['read', member, READ, SEED_NOW.getTime() + 30 * 86_400_000, 1],
      ['write', member, WRITE, null, 1],
      ['expired', member, WRITE, SEED_NOW.getTime() - 1, 1],
      ['disabled', member, WRITE, null, 0],
      ['rate', member, READ, null, 1],
      ['admin', admin, WRITE, null, 1],
    ]
    await db.batch(
      rows.map(([name, user, permissions, expiresAt, enabled], i) => ({
        sql: "insert into api_key (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, expires_at, created_at, updated_at, permissions, metadata) values (?, 'default', ?, null, ?, 'snow_', ?, ?, 0, 86400000, 10, 0, ?, ?, ?, ?, 'null')",
        args: [
          `01900000-0000-7000-8030-${String(i).padStart(12, '0')}`,
          name,
          user,
          hashKey(KEYS[name]),
          enabled,
          expiresAt,
          SEED_NOW.getTime() - (10 - i) * 60_000,
          SEED_NOW.getTime() - (10 - i) * 60_000,
          permissions,
        ],
      })),
      'write',
    )
  } finally {
    db.close()
  }
  return path
}

function masked(text: string, keys: string[]) {
  return keys.reduce(
    (masking, key) => masking.replaceAll(new RegExp(`"${key}":"[^"]*"`, 'g'), `"${key}":"…"`),
    text,
  )
}

export async function compareApiKeys(
  binary: string,
  database: string,
  judge: (label: string, a: Observation, b: Observation) => void,
) {
  const source = await fixtureDatabase(database)
  const ts = await startApp({ database: source })
  let native: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    native = await startNative(binary, source, { RATE_LIMIT: 'on' })
    const servers = { ts, native }
    const copies = {
      ts: join(CACHE, `run-${new URL(ts.url).port}.db`),
      native: join(CACHE, `native-${new URL(native.url).port}.db`),
    }
    const sessions = {
      ts: {
        admin: await signInHeaders(ts, 'admin'),
        member: await signInHeaders(ts, 'member'),
      },
      native: {
        admin: await signInHeaders(native, 'admin'),
        member: await signInHeaders(native, 'member'),
      },
    }
    type Side = keyof typeof servers
    type As =
      | { key: string; session?: 'admin' | 'member' }
      | { session: 'admin' | 'member' }
      | { header: string }
      | null
    async function send(
      side: Side,
      name: CallName,
      input: unknown,
      as: As,
      extra: Record<string, string> = {},
      body?: string,
    ) {
      const server: Server = servers[side]
      const route = requestOf(CALLS[name], input)
      const headers: Record<string, string> = { 'content-type': 'application/json', ...extra }
      if (as && 'key' in as) headers.authorization = `Bearer ${as.key}`
      if (as && 'header' in as) headers.authorization = as.header
      // A key's own requests carry no Origin, as a client outside the browser sends them.
      if (as && 'session' in as && as.session) {
        Object.assign(
          headers,
          sessions[side][as.session],
          'key' in as ? {} : { origin: server.url },
        )
      }
      const response = await fetch(`${server.url}${route.path}`, {
        method: CALLS[name].method,
        headers,
        body: body ?? route.body,
      })
      return { status: response.status, text: await response.text() }
    }
    async function both(
      label: string,
      name: CallName,
      input: unknown,
      as: As,
      expected: number,
      options: { mask?: string[]; extra?: Record<string, string>; body?: string } = {},
    ) {
      const [a, b] = await Promise.all(
        (['ts', 'native'] as const).map(async (side) => {
          const answer = await send(
            side,
            name,
            typeof input === 'function' ? input(side) : input,
            as,
            options.extra,
            options.body,
          )
          return {
            label,
            expected,
            status: answer.status,
            text: masked(answer.text, options.mask ?? []),
          }
        }),
      )
      judge(`api keys: ${label}`, a, b)
      if (a.status !== expected || b.status !== expected)
        throw new Error(`api keys: ${label}: expected ${expected}, got ${a.status}/${b.status}`)
      return [a, b]
    }
    const organizationId = COMPANY.id
    function key(name: keyof typeof KEYS) {
      return { key: KEYS[name] }
    }
    const member = { session: 'member' } as const
    const admin = { session: 'admin' } as const
    const timer = '01900000-0000-7000-8031-000000000001'
    const clock = ['startedAt', 'stoppedAt', 'createdAt', 'updatedAt']

    // The key's checks.
    await both('me, read key', 'getMe', undefined, key('read'), 200)
    await both('me, write key', 'getMe', undefined, key('write'), 200)
    await both('me, admin key', 'getMe', undefined, key('admin'), 200)
    await both('me, unknown key', 'getMe', undefined, { key: 'snow_unknown' }, 401)
    await both('me, expired key', 'getMe', undefined, key('expired'), 401)
    await both('me, disabled key', 'getMe', undefined, key('disabled'), 401)
    await both(
      'me, key beside the admin session',
      'getMe',
      undefined,
      { key: KEYS.read, session: 'admin' },
      200,
    )
    await both('me, lower-case scheme', 'getMe', undefined, { header: `bearer ${KEYS.read}` }, 200)
    await both(
      'me, spaces around the key',
      'getMe',
      undefined,
      { header: `Bearer   ${KEYS.read}  ` },
      200,
    )
    await both(
      'me, two words is no key',
      'getMe',
      undefined,
      { header: `Bearer ${KEYS.read} x` },
      401,
    )
    await both('me, basic credentials', 'getMe', undefined, { header: 'Basic dXNlcjpwYXNz' }, 401)
    await both('me, session', 'getMe', undefined, member, 200)

    // The calls a key reaches.
    await both('running timer, none', 'getRunningTimer', undefined, key('write'), 200)
    await both('projects', 'listProjects', { organizationId }, key('read'), 200)
    await both(
      'entries',
      'listEntries',
      { organizationId, from: new Date(SEED_NOW.getTime() - 7 * 86_400_000), to: SEED_NOW },
      key('read'),
      200,
    )
    await both(
      'start, read-only key',
      'startTimer',
      { organizationId, id: timer },
      key('read'),
      403,
    )
    await both(
      'start, another organization',
      'startTimer',
      { organizationId: 'nope', id: timer },
      key('write'),
      403,
    )
    await both('start, invalid input', 'startTimer', { organizationId, id: 'x' }, key('write'), 400)
    await both(
      'start without an Origin',
      'startTimer',
      { organizationId, id: timer, description: 'From a key' },
      key('write'),
      200,
      { mask: clock },
    )
    await both('running timer', 'getRunningTimer', undefined, key('read'), 200, { mask: clock })
    await both('stop', 'stopTimer', { id: timer }, key('write'), 200, { mask: clock })
    await both('stop, not running', 'stopTimer', { id: timer }, key('write'), 404)
    await both('stop, invalid id in Estonian', 'stopTimer', { id: 'nope' }, key('write'), 400, {
      extra: { 'accept-language': 'et', cookie: 'PARAGLIDE_LOCALE=et' },
    })

    // Calls a key can't make.
    for (const [name, input] of [
      ['getAppSession', undefined],
      ['getSignInMethods', undefined],
      ['checkAvailability', { slug: 'free' }],
      ['listApiKeys', undefined],
      ['createApiKey', { name: 'More', lifetime: 'none', access: 'write' }],
      ['revokeApiKey', { id: '01900000-0000-7000-8030-000000000000' }],
      ['updateSettings', { theme: 'dark' }],
      ['listTeams', { organizationId }],
      ['createEntry', { organizationId }],
    ] as [CallName, unknown][]) {
      await both(`${name}, key`, name, input, key('admin'), 403)
    }

    // Settings' calls.
    const listed = ['lastUsedAt']
    await both('list, member', 'listApiKeys', undefined, member, 200, { mask: listed })
    await both('list, admin', 'listApiKeys', undefined, admin, 200, { mask: listed })
    for (const [label, input] of [
      ['blank name', { name: '   ', lifetime: '30d', access: 'read' }],
      ['long name', { name: 'é'.repeat(33), lifetime: '30d', access: 'read' }],
      ['no name', { lifetime: '30d', access: 'read' }],
      ['no lifetime', { name: 'x', access: 'read' }],
      ['unknown lifetime', { name: 'x', lifetime: '2y', access: 'read' }],
      ['unknown access', { name: 'x', lifetime: '30d', access: 'admin' }],
    ] as const) {
      await both(`create, ${label}`, 'createApiKey', input, member, 400)
    }
    await both('create, body not JSON', 'createApiKey', undefined, member, 400, { body: '{' })
    await both(
      'create, no session and no Origin',
      'createApiKey',
      { name: 'x', lifetime: '30d', access: 'read' },
      null,
      403,
    )
    await both('revoke, invalid id', 'revokeApiKey', { id: 'x' }, member, 400)
    await both(
      'revoke, unknown',
      'revokeApiKey',
      { id: '01900000-0000-7000-8030-00000000ffff' },
      member,
      404,
    )
    await both(
      'revoke, another user’s key',
      'revokeApiKey',
      { id: '01900000-0000-7000-8030-000000000005' },
      member,
      404,
    )

    // New keys: the answer, the row, and each server's key on both servers.
    const created: Record<Side, { id: string; key: string }[]> = { ts: [], native: [] }
    for (const [lifetime, access] of [
      ['30d', 'read'],
      ['90d', 'write'],
      ['1y', 'read'],
      ['none', 'write'],
    ] as const) {
      await both(
        `create, ${lifetime} ${access}`,
        'createApiKey',
        { name: `  New ${lifetime} ${access} `, lifetime, access },
        member,
        200,
        { mask: ['id', 'key'] },
      )
    }
    // The created keys, read back from each copy to compare their rows.
    async function rowsOf(side: Side) {
      const db = createClient({ url: `file:${copies[side]}` })
      try {
        return (
          await db.execute(
            "select *, expires_at - created_at as lifetime, updated_at - created_at as updated from api_key where name like 'New %' order by name",
          )
        ).rows.map((row) => ({ ...row }))
      } finally {
        db.close()
      }
    }
    const generated = ['id', 'key', 'created_at', 'updated_at', 'expires_at']
    function comparable(rows: Record<string, unknown>[]) {
      return JSON.stringify(
        rows.map((row) =>
          Object.fromEntries(Object.entries(row).filter(([k]) => !generated.includes(k))),
        ),
      )
    }
    const [tsRows, nativeRows] = [await rowsOf('ts'), await rowsOf('native')]
    judge(
      'api keys: created rows, column by column',
      { label: 'rows', expected: 0, status: 0, text: comparable(tsRows) },
      { label: 'rows', expected: 0, status: 0, text: comparable(nativeRows) },
    )
    for (const { id } of [...tsRows, ...nativeRows]) {
      if (
        typeof id !== 'string' ||
        !/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(id)
      )
        throw new Error(`api keys: ${JSON.stringify(id)} isn't a UUIDv7`)
    }

    await both('list after creating', 'listApiKeys', undefined, member, 200, {
      mask: ['id', 'createdAt', 'expiresAt', 'lastUsedAt'],
    })
    // A key from each server, created on its own copy, then its row copied to the other. The
    // servers' clocks start apart, so the copied rows sort differently and come last.
    for (const side of ['ts', 'native'] as const) {
      const response = await send(
        side,
        'createApiKey',
        { name: 'Crossing', lifetime: '30d', access: 'write' },
        member,
      )
      created[side].push(JSON.parse(response.text))
    }
    for (const [from, to] of [
      ['ts', 'native'],
      ['native', 'ts'],
    ] as const) {
      const { id, key: secret } = created[from][0]
      const source = createClient({ url: `file:${copies[from]}` })
      const target = createClient({ url: `file:${copies[to]}` })
      try {
        const row = (
          await source.execute({ sql: 'select * from api_key where id = ?', args: [id] })
        ).rows[0]
        const columns = Object.keys(row)
        await target.execute({
          sql: `insert into api_key (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`,
          args: columns.map((column) => row[column] as never),
        })
      } finally {
        source.close()
        target.close()
      }
      for (const side of ['ts', 'native'] as const) {
        const answer = await send(side, 'getMe', undefined, { key: secret })
        if (answer.status !== 200)
          throw new Error(`api keys: ${from}'s key on ${side}: ${answer.status}`)
      }
    }

    // The last use: saved on the first call, then at most once a minute.
    async function lastUse(side: Side, secret: string) {
      const db = createClient({ url: `file:${copies[side]}` })
      try {
        const rows = await db.execute({
          sql: 'select last_request from api_key where key = ?',
          args: [hashKey(secret)],
        })
        return rows.rows[0].last_request as number | null
      } finally {
        db.close()
      }
    }
    const lastUses = await Promise.all(
      (['ts', 'native'] as const).map(async (side) => {
        const first = await lastUse(side, KEYS.read)
        await send(side, 'getMe', undefined, key('read'))
        const second = await lastUse(side, KEYS.read)
        const never = await lastUse(side, KEYS.disabled)
        return JSON.stringify({
          saved: first !== null,
          kept: first === second,
          refusedKeyUnused: never === null,
        })
      }),
    )
    judge(
      'api keys: last use saved once a minute',
      { label: 'last use', expected: 0, status: 0, text: lastUses[0] },
      { label: 'last use', expected: 0, status: 0, text: lastUses[1] },
    )

    // Revoking: only the user's own key, which then stops working.
    await both(
      'revoke, own key',
      'revokeApiKey',
      (side: Side) => ({ id: created[side][0].id }),
      member,
      200,
      { mask: ['id'] },
    )
    for (const side of ['ts', 'native'] as const) {
      const answer = await send(side, 'getMe', undefined, { key: created[side][0].key })
      if (answer.status !== 401)
        throw new Error(`api keys: revoked key on ${side}: ${answer.status}`)
    }

    // The cap: 25 keys per user, expired ones included.
    function adminCreate(i: number) {
      return both(
        `create, admin key ${i + 2}`,
        'createApiKey',
        { name: `Admin ${i}`, lifetime: '30d', access: 'read' },
        admin,
        200,
        {
          mask: ['id', 'key'],
        },
      )
    }
    for (let i = 0; i < 24; i++) await adminCreate(i)
    await both(
      'create, 26th key',
      'createApiKey',
      { name: 'One too many', lifetime: '30d', access: 'read' },
      admin,
      422,
    )

    // The per-key rate: 120 a minute, every call counted.
    for (let i = 0; i < 119; i++) {
      await Promise.all(
        (['ts', 'native'] as const).map((side) =>
          send(side, 'getRunningTimer', undefined, key('rate')),
        ),
      )
    }
    await both('120th call of a key', 'getRunningTimer', undefined, key('rate'), 200)
    await both('121st call of a key', 'getRunningTimer', undefined, key('rate'), 429)
    await both('another key after one is limited', 'getRunningTimer', undefined, key('read'), 200)
  } finally {
    await ts.stop()
    await native?.stop()
  }
}
