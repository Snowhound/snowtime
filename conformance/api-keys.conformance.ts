// Personal API keys on the contract, over HTTP, as timer.conformance.ts runs: Settings
// manages them with the session, and a key signs in the calls marked `apiKeys` (docs/api.md).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Transport } from '~/lib/api/client'
import type { OperationName } from '~/lib/api/operations'
import { httpTransport } from '~/lib/api/transports'
import { COMPANY, SEED_NOW } from '../perf/lib/database'
import { send as sendTo, type ServerUnderTest, serverUnderTest } from './server'

let server: ServerUnderTest
let headers: { admin: Record<string, string>; member: Record<string, string> }
let member: Transport
let readKey: { id: string; key: string }
let writeKey: { id: string; key: string }

beforeAll(async () => {
  server = await serverUnderTest()
  headers = { admin: await server.as('admin'), member: await server.as('member') }
  member = httpTransport(server.url, headers.member)
  readKey = await member('createApiKey', { name: 'Reader', lifetime: '90d', access: 'read' })
  writeKey = await member('createApiKey', { name: 'Writer', lifetime: 'none', access: 'write' })
}, 120_000)
afterAll(() => server?.stop())

function send(name: OperationName, input: unknown, as: Record<string, string>) {
  return sendTo(server.url, name, input, as)
}

// A key's headers, with no cookie and no Origin, as a client outside the browser sends.
function bearer(key: string) {
  return { authorization: `Bearer ${key}` }
}

function keyRefused(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } }
}

describe('managing keys', () => {
  test('the list names keys and shows no part of one', async () => {
    const keys = await member('listApiKeys', undefined)
    expect(keys.map((k) => [k.name, k.access])).toEqual([
      ['Writer', 'write'],
      ['Reader', 'read'],
    ])
    expect(keys[0].expiresAt).toBeNull()
    expect(JSON.stringify(keys)).not.toContain(writeKey.key)
    expect(writeKey.key.startsWith('snow_')).toBe(true)
  })

  test('a key can neither list, create, nor revoke keys', async () => {
    const refusal = keyRefused(403, 'FORBIDDEN', 'API keys cannot make this call.')
    expect(await send('listApiKeys', undefined, bearer(writeKey.key))).toEqual(refusal)
    expect(
      await send(
        'createApiKey',
        { name: 'More', lifetime: 'none', access: 'write' },
        bearer(writeKey.key),
      ),
    ).toEqual(refusal)
    expect(await send('revokeApiKey', { id: readKey.id }, bearer(writeKey.key))).toEqual(refusal)
  })

  test("revoking another user's key is refused, and a revoked key stops working", async () => {
    const spare = await member('createApiKey', { name: 'Spare', lifetime: '30d', access: 'read' })
    expect((await send('revokeApiKey', { id: spare.id }, headers.admin)).status).toBe(404)
    expect((await send('getMe', undefined, bearer(spare.key))).status).toBe(200)
    expect(await member('revokeApiKey', { id: spare.id })).toEqual({ id: spare.id })
    expect(await send('getMe', undefined, bearer(spare.key))).toEqual(
      keyRefused(401, 'UNAUTHENTICATED', 'Invalid API key.'),
    )
  })
})

describe('signing in with a key', () => {
  test('getMe answers the key’s user and organizations', async () => {
    const { status, body } = await send('getMe', undefined, bearer(readKey.key))
    expect(status).toBe(200)
    expect(body).toMatchObject({
      user: { email: 'liis@lumen.example.com' },
      organizations: [{ id: COMPANY.id, slug: COMPANY.slug, role: 'member' }],
    })
  })

  test('an unknown key is refused, even beside a working session', async () => {
    expect(await send('getMe', undefined, { ...headers.admin, ...bearer('snow_unknown') })).toEqual(
      keyRefused(401, 'UNAUTHENTICATED', 'Invalid API key.'),
    )
  })

  test("the key alone signs in: another user's session cookie is ignored", async () => {
    const { body } = await send('getMe', undefined, {
      ...headers.admin,
      ...bearer(readKey.key),
    })
    expect(body).toMatchObject({ user: { email: 'liis@lumen.example.com' } })
  })

  test('a call not open to keys is refused', async () => {
    expect(await send('listTeams', { organizationId: COMPANY.id }, bearer(writeKey.key))).toEqual(
      keyRefused(403, 'FORBIDDEN', 'API keys cannot make this call.'),
    )
  })

  test('a read-only key reads but cannot write', async () => {
    const projects = await send('listProjects', { organizationId: COMPANY.id }, bearer(readKey.key))
    expect(projects.status).toBe(200)
    expect(
      await send('startTimer', { organizationId: COMPANY.id, id: uuidv7() }, bearer(readKey.key)),
    ).toEqual(keyRefused(403, 'FORBIDDEN', 'API key is read-only.'))
  })
})

describe('the timer with a write key', () => {
  const id = uuidv7()

  test('starts a timer without an Origin, then reads and stops it', async () => {
    const key = bearer(writeKey.key)
    const start = await send(
      'startTimer',
      { organizationId: COMPANY.id, id, description: 'From Raycast' },
      key,
    )
    expect(start.status).toBe(200)
    expect(await send('getRunningTimer', undefined, key)).toMatchObject({
      status: 200,
      body: { id, description: 'From Raycast', stoppedAt: null },
    })
    const stop = await send('stopTimer', { id }, key)
    expect(stop).toMatchObject({ status: 200, body: { id } })
    expect((await send('getRunningTimer', undefined, key)).body).toBeNull()
  })

  test("lists the key's user's entries", async () => {
    const { status, body } = await send(
      'listEntries',
      {
        organizationId: COMPANY.id,
        from: new Date(SEED_NOW.getTime() - 86_400_000),
        to: new Date(Date.now() + 86_400_000),
      },
      bearer(readKey.key),
    )
    expect(status).toBe(200)
    expect((body as { id: string }[]).map((e) => e.id)).toContain(id)
  })

  test('refusals of the rules carry their code and key, and validation messages are English', async () => {
    const key = bearer(writeKey.key)
    expect(await send('stopTimer', { id }, key)).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', key: 'timer_not_running' } },
    })
    const { status, body } = await send(
      'stopTimer',
      { id: 'nope' },
      {
        ...key,
        'accept-language': 'et',
        cookie: 'PARAGLIDE_LOCALE=et',
      },
    )
    expect(status).toBe(400)
    expect(body).toEqual({ error: { message: expect.stringContaining('Invalid id') } })
  })
})
