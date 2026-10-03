// Hydration equality (task 084): a server render calls the API in process and dehydrates
// what it got through Start's serializer, seroval; after hydration the browser calls the
// same API over HTTP. Both must fill the query cache with equal values, or the first
// refetch after hydration changes what the page shows.
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { deserialize, serialize } from 'seroval'
import type { Database } from '~/db'
import { withActor } from '~/db/actor'
import { seedIds } from '~/db/seed'
import type { Transport } from '~/lib/api/client'
import { type InputOf, type OperationName, operations } from '~/lib/api/operations'
import { type Host, hostTransport, httpTransport } from '~/lib/api/transports'
import { matchPath } from '~/lib/api/wire'
import { AppError } from './errors'
import { createSeededDatabase } from './testing'

// Better Auth and the environment need the server's settings, which tests don't have; these
// calls don't use them.
await mock.module('~/env', () => ({ env: {}, appUrl: 'http://localhost:3000', trustedOrigins: [] }))
await mock.module('./auth/better-auth.server', () => ({
  auth: {},
  rateLimitStore: {},
  sessionOf: async () => null,
}))
const { runOperation } = await import('./operations.server')

const NOW = new Date('2026-09-30T07:30:00Z')
const { users: U, orgs: O } = seedIds

let db: Database
let cleanup: () => Promise<void>

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
})
afterAll(() => cleanup())

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// The API's handlers for one user, as renderTransport runs them for the page's request.
function hostFor(userId: string): Host {
  return {
    call: (name, input) =>
      withActor(userId, () =>
        runOperation(db, name as never, { userId, headers: new Headers() }, input),
      ),
  }
}

// The browser's transport, with each request answered by the same handlers as JSON.
function overHttp(name: OperationName, host: Host): Transport {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const input = {
      ...Object.fromEntries(searchParams),
      ...(init.body ? JSON.parse(init.body as string) : {}),
      ...matchPath(operations[name].path, pathname),
    }
    const { status, body } = await host.call(name, input)
    return Response.json(body, { status })
  }) as typeof fetch
  return httpTransport('https://snowtime.example')
}

// What the page dehydrates from the server render, and what the browser decodes later.
async function bothWays<K extends OperationName>(userId: string, name: K, input: InputOf<K>) {
  const host = hostFor(userId)
  const rendered = await hostTransport(host)(name, input)
  const fetched = await overHttp(name, host)(name, input)
  return { hydrated: deserialize(serialize(rendered)) as typeof rendered, fetched }
}

describe('a server render fills the cache as the browser does later', () => {
  test('the running timer, with its project', async () => {
    const { hydrated, fetched } = await bothWays(U.member, 'getRunningTimer', undefined)
    expect(fetched).not.toBeNull()
    expect(fetched!.startedAt).toBeInstanceOf(Date)
    expect(fetched).toStrictEqual(hydrated)
  })

  test('a range of entries, a running one included', async () => {
    const { hydrated, fetched } = await bothWays(U.member, 'listEntries', {
      organizationId: O.northwind,
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
      userId: U.member,
    })
    expect(fetched.length).toBeGreaterThan(0)
    expect(fetched.some((e) => e.stoppedAt === null)).toBe(true)
    expect(fetched).toStrictEqual(hydrated)
  })

  test('a date alone', async () => {
    const { hydrated, fetched } = await bothWays(U.member, 'getFirstEntryStart', {
      organizationId: O.northwind,
      userId: U.member,
    })
    expect(fetched).toBeInstanceOf(Date)
    expect(fetched).toStrictEqual(hydrated)
  })

  test("a report's entries, one of two shapes, with their dates", async () => {
    const { hydrated, fetched } = await bothWays(U.admin, 'getReportEntries', {
      organizationId: O.northwind,
      report: { from: '2026-09-21', to: '2026-09-28' },
      view: 'day',
    })
    expect(fetched).toStrictEqual(hydrated)
    if (fetched.view !== 'day') throw new Error('Not By day')
    expect(fetched.pieces[0].from).toBeInstanceOf(Date)
  })

  test('a refusal arrives as the same AppError both ways', async () => {
    const host = hostFor(U.member)
    const input = { organizationId: O.northwind, userId: U.owner }
    for (const transport of [hostTransport(host), overHttp('getFirstEntryStart', host)]) {
      const call = transport('getFirstEntryStart', input)
      await expect(call).rejects.toBeInstanceOf(AppError)
      await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'entries_forbidden' })
    }
  })
})
