// The client module's transports. Both send the contract's JSON (wire.ts) and decode the
// answer with the output schemas, so a server render and the browser fill the cache alike.
import type { Transport } from './client'
import { operations } from './operations'
import { requestOf, resultOf, type WireResponse } from './wire'

// The JSON API over HTTP. In the browser the session cookie goes along, and the browser
// sets `Origin`, which the server checks on writes; other callers pass both in `headers`.
export function httpTransport(origin = '', headers: Record<string, string> = {}): Transport {
  return async (name, input) => {
    const operation = operations[name]
    const { path, body } = requestOf(operation, input)
    const response = await fetch(`${origin}${path}`, {
      method: operation.method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      body,
      credentials: 'same-origin',
    })
    return resultOf(operation, { status: response.status, body: await response.json() })
  }
}

// What a server render calls the API through: Start's server render (renderTransport in
// src/server/api.server.ts), or the native backend's render isolate (task 081.01). The host
// runs the handler the HTTP API runs, in process and for the page's own request, and
// answers with the status and body it would send. The input arrives as JSON, as over HTTP.
export interface Host {
  call(name: string, input: unknown): Promise<WireResponse>
}

export function hostTransport(host: Host): Transport {
  return async (name, input) => {
    const json: unknown = input === undefined ? null : JSON.parse(JSON.stringify(input))
    return resultOf(operations[name], await host.call(name, json))
  }
}
