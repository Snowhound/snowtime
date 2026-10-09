import { afterAll, beforeAll, expect, test } from 'bun:test'
import { PasskeyAuthenticator } from './passkey-authenticator'
import { passkeyFlow } from './passkey-flow'
import { serverUnderTest, type ServerUnderTest } from './server'

let server: ServerUnderTest
beforeAll(async () => {
  server = await serverUnderTest()
}, 120_000)
afterAll(() => server?.stop())

test('passkey registration, sign-in, listing, removal, and refusal contracts', async () => {
  await passkeyFlow(
    server,
    ['ES256', 'EdDSA', 'RS256'].map(
      (algorithm) => new PasskeyAuthenticator(algorithm as 'ES256' | 'EdDSA' | 'RS256'),
    ),
    ({ status, expected }) => expect(status).toBe(expected),
  )
}, 120_000)
