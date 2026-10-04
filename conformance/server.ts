// The server the conformance tests run against. CONFORMANCE_URL names a running one, such
// as the native backend, which must serve the benchmark database (perf/lib/database.ts)
// with its clock at SEED_NOW and password sign-in on. Without it, the tests build the
// TypeScript app and serve it as the perf harnesses do (perf/lib/app.ts).
import * as auth from '~/lib/api/auth'
import * as availability from '~/lib/api/availability'
import * as entries from '~/lib/api/entries'
import * as projects from '~/lib/api/projects'
import * as reports from '~/lib/api/reports'
import { setSend } from '~/lib/api/request'
import * as settings from '~/lib/api/settings'
import * as teams from '~/lib/api/teams'
import * as timer from '~/lib/api/timer'
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

// The client modules' functions by name: the tests call the API as the app does, so its
// paths and bodies are under test too.
const calls = {
  ...auth,
  ...availability,
  ...entries,
  ...projects,
  ...reports,
  ...settings,
  ...teams,
  ...timer,
}
type Calls = typeof calls

export type CallName = keyof Calls

// Calls the API as the app does, decoding answers, but on the server under test and with
// `headers` for the session and Origin.
export type Caller = <K extends CallName>(
  name: K,
  input: Parameters<Calls[K]>[0],
) => ReturnType<Calls[K]>

// Points the client at the server under test, with `headers` on every request. A call
// uses the one set when it starts.
function sendTo(url: string, headers: Record<string, string>, seen?: (r: Response) => void) {
  setSend(async (path, init) => {
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    })
    seen?.(response.clone())
    return response
  })
}

function callByName(name: CallName, input: unknown) {
  return (calls[name] as (input: unknown) => Promise<unknown>)(input)
}

export function caller(url: string, headers: Record<string, string>): Caller {
  return ((name: CallName, input: unknown) => {
    sendTo(url, headers)
    return callByName(name, input)
  }) as Caller
}

// A call's raw answer, for the refusals the client would throw.
export async function send(
  url: string,
  name: CallName,
  input: unknown,
  headers: Record<string, string>,
) {
  let answer: Response | undefined
  sendTo(url, headers, (response) => {
    answer = response
  })
  await callByName(name, input).catch(() => {})
  return { status: answer!.status, body: (await answer!.json()) as unknown }
}

export function refused(code: string, key: string) {
  return { error: { code, key } }
}
