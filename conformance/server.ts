// The server the conformance tests run against. CONFORMANCE_URL names a running one, such
// as the native backend, which must serve the benchmark database (perf/lib/database.ts)
// with its clock at SEED_NOW and password sign-in on. Without it, the tests build the
// TypeScript app and serve it as the perf harnesses do (perf/lib/app.ts).
import { buildApp, signInHeaders, startApp } from '../perf/lib/app'
import { seededDatabase, type USERS } from '../perf/lib/database'

export interface ServerUnderTest {
  url: string
  // Session headers for a seeded user, with the app's own Origin, as its pages send.
  as: (who: keyof typeof USERS) => Promise<Record<string, string>>
  stop: () => Promise<void>
}

export async function serverUnderTest(): Promise<ServerUnderTest> {
  const external = process.env.CONFORMANCE_URL
  if (external) {
    return {
      url: external,
      as: async (who) => ({ ...(await signInHeaders({ url: external }, who)), origin: external }),
      stop: async () => {},
    }
  }
  const [database] = await Promise.all([seededDatabase(), buildApp()])
  const app = await startApp({ database })
  return {
    url: app.url,
    as: async (who) => ({ ...(await signInHeaders(app, who)), origin: app.url }),
    stop: app.stop,
  }
}
