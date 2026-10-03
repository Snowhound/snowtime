// A transport for component tests: each call answers from its mock by name, and a call
// without one fails, as when offline, so the cache keeps what the test put there.
import type { Transport } from './client'

export function mockTransport(mocks: object): Transport {
  return (name, input) => {
    const mock = (mocks as Record<string, ((input: unknown) => never) | undefined>)[name]
    return mock ? Promise.resolve(mock(input)) : Promise.reject(new Error(`No mock for ${name}`))
  }
}
