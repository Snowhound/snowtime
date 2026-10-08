// How the client modules (entries.ts, ...) call the JSON API (task 089): over HTTP in the
// browser, and in process during a server render (src/server-entry.ts sets that, and the
// native backend's render isolate does the same). Either way the answer is decoded alike, so
// a server render and the browser fill the query cache with the same values.
import type * as v from 'valibot'
import { AppError } from '~/server/errors'
import { decode, type WireError } from './wire'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// Sends one request to the API, by its path from /api/v1 on.
export type Send = (path: string, init: RequestInit) => Response | Promise<Response>

// In the browser the session cookie goes along, and the browser sets `Origin`, which the
// server checks on writes.
let send: Send = (path, init) => fetch(path, { ...init, credentials: 'same-origin' })

// Set once at startup, before the first call. A call uses the one set when it starts.
export function setSend(next: Send) {
  send = next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Calls the API with the input as the query string of a GET or the JSON body of any other
// method, and returns the answer decoded with the output schema. A refusal throws: a rule's
// as its AppError, and Better Auth's with its status and code, as Better Auth's client
// reports one (src/lib/errors.ts).
export async function request<S extends v.GenericSchema>(
  method: Method,
  path: string,
  input: object | undefined,
  output: S,
): Promise<v.InferOutput<S>> {
  // Dates become ISO strings, as JSON carries them.
  const fields = JSON.parse(JSON.stringify(input ?? {})) as Record<string, string>
  let url = path
  let body: string | undefined
  if (method === 'GET') {
    const query = new URLSearchParams(fields).toString()
    if (query) url += `?${query}`
  } else if (Object.keys(fields).length > 0) {
    body = JSON.stringify(fields)
  }
  const response = await send(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body,
  })
  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    if (response.ok) throw error
  }
  if (response.ok) return decode(output, json)
  const error = isRecord(json) ? (json.error as WireError | undefined) : undefined
  const thrown =
    error && 'key' in error
      ? new AppError(error.code, error.key)
      : new Error(error?.message ?? `HTTP ${response.status}`)
  throw Object.assign(thrown, {
    status: response.status,
    code: error?.code,
    retryAfter: response.headers.get('retry-after'),
  })
}
