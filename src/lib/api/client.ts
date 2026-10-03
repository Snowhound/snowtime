// The data layer's one way to the backend (task 084). Query and mutation functions call
// `call`; the transport behind it is a server function in the TypeScript app, the JSON API
// over HTTP in the browser on the native backend, or the host in the native backend's
// render isolate. Every transport gives the query cache the same shapes.
import type { InputOf, OperationName, OutputOf } from './operations'
import { serverFunctions } from './server-functions'

export type Transport = <K extends OperationName>(
  name: K,
  input: InputOf<K>,
) => Promise<OutputOf<K>>

let transport: Transport = serverFunctions

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
