// The data layer's one way to the backend (task 084). Query and mutation functions call
// `call`; the transport behind it is the JSON API over HTTP in the browser, or the API in
// process during a server render (src/server-entry.ts, and the native backend's render
// isolate). Every transport gives the query cache the same shapes.
import type { InputOf, OperationName, OutputOf } from './operations'
import { httpTransport } from './transports'

export type Transport = <K extends OperationName>(
  name: K,
  input: InputOf<K>,
) => Promise<OutputOf<K>>

let transport: Transport = httpTransport()

// Set once at startup, before the first call; tests set it per case.
export function setTransport(next: Transport) {
  transport = next
}

// A call without input takes only its name.
export function call<K extends OperationName>(
  name: K,
  ...[input]: InputOf<K> extends void ? [] : [InputOf<K>]
): Promise<OutputOf<K>> {
  return transport(name, input as InputOf<K>)
}
