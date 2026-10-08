import { afterAll, beforeAll, expect, test } from 'bun:test'
import { authWritesFlow } from './auth-writes-flow'
import { serverUnderTest, type ServerUnderTest } from './server'
let server: ServerUnderTest
beforeAll(async () => {
  server = await serverUnderTest()
}, 120_000)
afterAll(() => server?.stop())
test('organization writes, profile updates, and removal hooks', async () => {
  await authWritesFlow(server, ({ status, expected }) => expect(status).toBe(expected))
}, 120_000)
