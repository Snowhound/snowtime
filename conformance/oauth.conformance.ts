import { afterAll, beforeAll, expect, test } from 'bun:test'
import { buildApp, startApp } from '../perf/lib/app'
import { seededDatabase } from '../perf/lib/database'
import { oauthFlow } from './oauth-flow'
import { oauthEnv, startOAuthProvider } from './oauth-provider'

let server: { url: string; stop: () => Promise<void> }
let provider: ReturnType<typeof startOAuthProvider> | undefined
beforeAll(async () => {
  if (process.env.CONFORMANCE_URL) {
    server = { url: process.env.CONFORMANCE_URL, stop: async () => {} }
  } else {
    provider = startOAuthProvider()
    await buildApp()
    server = await startApp({ database: await seededDatabase(), env: oauthEnv(provider.url) })
  }
}, 120_000)
afterAll(async () => {
  await server?.stop()
  await provider?.stop()
})
test('OAuth redirect sign-in, PKCE, state, linking, and account management contracts', async () => {
  await oauthFlow(
    server,
    provider?.url ?? process.env.OAUTH_FAKE_PROVIDER!,
    ({ status, expected }) => expect(status).toBe(expected),
  )
}, 120_000)
