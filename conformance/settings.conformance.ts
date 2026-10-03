// The user's settings on the contract (task 084), over HTTP, as timer.conformance.ts runs.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Transport } from '~/lib/api/client'
import { httpTransport } from '~/lib/api/transports'
import { COLLECTION_IMAGES } from '~/lib/scene/images'
import { refused, send, type ServerUnderTest, serverUnderTest } from './server'

let server: ServerUnderTest
let headers: Record<string, string>
let member: Transport

beforeAll(async () => {
  server = await serverUnderTest()
  headers = await server.as('member')
  member = httpTransport(server.url, headers)
}, 120_000)
afterAll(() => server?.stop())

describe('settings', () => {
  test('creating settings the user already has returns them unchanged', async () => {
    const { status, body } = await send(
      server.url,
      'createSettings',
      { timeZone: 'Asia/Tokyo', locale: 'et' },
      headers,
    )
    expect(status).toBe(200)
    expect(body).toMatchObject({ timeZone: 'Europe/Tallinn' })
    expect(body).not.toHaveProperty('userId')
    expect(body).not.toHaveProperty('createdAt')
  })

  test('a patch changes only its fields', async () => {
    const before = await member('createSettings', { timeZone: 'UTC' })
    const after = await member('updateSettings', { weekStart: 'sun' })
    expect(after).toEqual({ ...before, weekStart: 'sun' })
    expect(await member('updateSettings', { weekStart: before.weekStart })).toEqual(before)
  })

  test('a pinned image must be in the collection', async () => {
    const [image] = COLLECTION_IMAGES.coast
    expect(
      await send(
        server.url,
        'updateSettings',
        { sceneCollection: 'mountains', scenePin: image },
        headers,
      ),
    ).toEqual({ status: 422, body: refused('INVALID', 'scene_pin_not_in_collection') })
  })

  test('a write from the app without a session is refused', async () => {
    expect(
      await send(server.url, 'updateSettings', { weekStart: 'sun' }, { origin: headers.origin }),
    ).toEqual({
      status: 401,
      body: refused('UNAUTHENTICATED', 'sign_in_required'),
    })
  })
})
