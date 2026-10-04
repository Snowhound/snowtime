// The server the conformance tests run against. CONFORMANCE_URL names a running one, such
// as the native backend, which must serve the benchmark database (perf/lib/database.ts)
// with its clock at SEED_NOW and password sign-in on. Without it, the tests build the
// TypeScript app and serve it as the perf harnesses do (perf/lib/app.ts).
import { call, setTransport } from '~/lib/api/client'
import * as entries from '~/lib/api/entries'
import { type InputOf, type OperationName, operations, type OutputOf } from '~/lib/api/operations'
import { setSend } from '~/lib/api/request'
import { httpTransport } from '~/lib/api/transports'
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

// The client modules' functions by name, as the app calls the API.
const calls = { ...entries }

export type CallName = OperationName | keyof typeof calls
type CallInput<K extends CallName> = K extends keyof typeof calls
  ? Parameters<(typeof calls)[K]>[0]
  : K extends OperationName
    ? InputOf<K>
    : never
type CallOutput<K extends CallName> = K extends keyof typeof calls
  ? Awaited<ReturnType<(typeof calls)[K]>>
  : K extends OperationName
    ? OutputOf<K>
    : never

// Calls the API as the app does, decoding answers, but on the server under test and with
// `headers` for the session and Origin.
export type Caller = <K extends CallName>(name: K, input: CallInput<K>) => Promise<CallOutput<K>>

function sendTo(url: string, headers: Record<string, string>, onAnswer?: (r: Response) => void) {
  setSend(async (path, init) => {
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    })
    onAnswer?.(response.clone())
    return response
  })
  setTransport(httpTransport(url, headers))
}

function callByName(name: CallName, input: unknown): Promise<unknown> {
  if (name in calls)
    return (calls as Record<string, (input: unknown) => Promise<unknown>>)[name](input)
  return (call as (name: string, input: unknown) => Promise<unknown>)(name, input)
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
  if (!(name in calls)) {
    const operation = operations[name as OperationName]
    const { requestOf } = await import('~/lib/api/wire')
    const { path, body } = requestOf(operation, input)
    answer = await fetch(`${url}${path}`, {
      method: operation.method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      body,
    })
  } else {
    await callByName(name, input).catch(() => {})
  }
  return { status: answer!.status, body: (await answer!.json()) as unknown }
}

export function refused(code: string, key: string) {
  return { error: { code, key } }
}
