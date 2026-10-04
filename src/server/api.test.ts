// Hydration equality (task 084): a server render calls the API in process and dehydrates
// what it got through Start's serializer, seroval; after hydration the browser decodes the
// same API's answers over HTTP. Both must fill the query cache with equal values, or the first
// refetch after hydration changes what the page shows.
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { deserialize, serialize } from 'seroval'
import { seedIds } from '~/db/seed'
import { AppError } from './errors'
import { createSeededDatabase } from './testing'

const NOW = new Date('2026-09-30T07:30:00Z')
const { users: U, orgs: O } = seedIds

const { db, cleanup } = await createSeededDatabase(NOW)
afterAll(() => cleanup())

// Better Auth and the environment need the server's settings, which tests don't have. The
// session is the user a test names in its own header.
await mock.module('~/env', () => ({ env: {}, appUrl: 'http://localhost:3000', trustedOrigins: [] }))
await mock.module('~/db', () => ({ db }))
// Only the old name transport (renderTransport) reads the page's request.
await mock.module('@tanstack/solid-start/server', () => ({
  getRequest: () => new Request('http://x'),
}))
await mock.module('./auth/better-auth.server', () => ({
  auth: {},
  rateLimitStore: {},
  sessionOf: async (headers: Headers) => {
    const userId = headers.get('x-test-user')
    return userId ? { session: { userId } } : null
  },
}))
const { api } = await import('./api.server')
const { setSend } = await import('~/lib/api/request')
const entries = await import('~/lib/api/entries')

// The API in process for one user, as a server render calls it.
function as(userId: string) {
  setSend((path, init) => {
    const headers = new Headers(init.headers)
    headers.set('x-test-user', userId)
    return api.request(path, { ...init, headers })
  })
}

// What a call returns, and the same after the page dehydrates it and the browser hydrates it.
async function bothWays<T>(userId: string, call: () => Promise<T>) {
  as(userId)
  const fetched = await call()
  return { hydrated: deserialize<T>(serialize(fetched)), fetched }
}

describe('a server render fills the cache as the browser does later', () => {
  test('a range of entries, a running one included', async () => {
    const { hydrated, fetched } = await bothWays(U.member, () =>
      entries.listEntries({
        organizationId: O.northwind,
        from: new Date('2026-09-01T00:00:00Z'),
        to: new Date('2026-10-01T00:00:00Z'),
        userId: U.member,
      }),
    )
    expect(fetched.length).toBeGreaterThan(0)
    expect(fetched.some((e) => e.stoppedAt === null)).toBe(true)
    expect(fetched).toStrictEqual(hydrated)
  })

  test('a date alone', async () => {
    const { hydrated, fetched } = await bothWays(U.member, () =>
      entries.getFirstEntryStart({ organizationId: O.northwind, userId: U.member }),
    )
    expect(fetched).toBeInstanceOf(Date)
    expect(fetched).toStrictEqual(hydrated)
  })

  test('a refusal arrives as the AppError the rule threw', async () => {
    as(U.member)
    const call = entries.getFirstEntryStart({ organizationId: O.northwind, userId: U.owner })
    await expect(call).rejects.toBeInstanceOf(AppError)
    await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'entries_forbidden' })
  })
})
