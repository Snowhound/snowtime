// Hydration equality (task 084): a page the TypeScript app renders dehydrates what a server
// function returned, through Start's serializer, seroval. The native backend's page gets the
// same reads from its host, as the JSON API sends them, decoded by the output schemas. Both
// must fill the query cache with equal values, or the first refetch after hydration changes
// what the page shows.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { deserialize, serialize } from 'seroval'
import type { Database } from '~/db'
import { withActor } from '~/db/actor'
import { seedIds } from '~/db/seed'
import { hostTransport } from '~/lib/api/transports'
import * as entries from './entries/entries.server'
import { AppError } from './errors'
import { runOperation } from './operations.server'
import { createSeededDatabase, scopeOf } from './testing'
import * as timer from './timer/timer.server'

const NOW = new Date('2026-09-30T07:30:00Z')
const { users: U, orgs: O } = seedIds

let db: Database
let cleanup: () => Promise<void>

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
})
afterAll(() => cleanup())

function dehydrated<T>(value: T): T {
  return deserialize(serialize(value))
}

// The render isolate's transport, with a host that runs the TypeScript handler and sends
// its body through JSON, as the native backend's host would.
function hostFor(userId: string) {
  return hostTransport({
    call: async (name, input) => {
      const { status, body } = await withActor(userId, () =>
        runOperation(db, name as never, userId, input),
      )
      return { status, body: JSON.parse(JSON.stringify(body)) }
    },
  })
}

describe('the host transport fills the cache as a server render does', () => {
  test('the running timer, with its project', async () => {
    const value = await hostFor(U.member)('getRunningTimer', undefined)
    expect(value).not.toBeNull()
    expect(value!.startedAt).toBeInstanceOf(Date)
    expect(value).toStrictEqual(dehydrated(await timer.getRunningTimer(db, U.member)))
  })

  test('a range of entries, a running one included', async () => {
    const scope = await scopeOf(db, U.member, O.northwind)
    const input = {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
      userId: U.member,
    }
    const value = await hostFor(U.member)('listEntries', { ...input, organizationId: O.northwind })
    expect(value.length).toBeGreaterThan(0)
    expect(value.some((e) => e.stoppedAt === null)).toBe(true)
    expect(value).toStrictEqual(dehydrated(await entries.listEntries(db, scope, input)))
  })

  test('a date alone', async () => {
    const scope = await scopeOf(db, U.member, O.northwind)
    const value = await hostFor(U.member)('getFirstEntryStart', {
      organizationId: O.northwind,
      userId: U.member,
    })
    expect(value).toBeInstanceOf(Date)
    expect(value).toStrictEqual(
      dehydrated(await entries.getFirstEntryStart(db, scope, { userId: U.member })),
    )
  })

  test('a refusal arrives as the AppError the server function throws', async () => {
    const call = hostFor(U.member)('getFirstEntryStart', {
      organizationId: O.northwind,
      userId: U.owner,
    })
    await expect(call).rejects.toBeInstanceOf(AppError)
    await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'entries_forbidden' })
  })
})
