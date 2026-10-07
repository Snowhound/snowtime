// The Server-Timing header of page and API responses: how long a request spent looking up
// the session, in the database, and, for a page, until its first byte ("Server-Timing" in
// docs/architecture/platform.md). It carries durations only, so it stays on in production.
import type { Client, Transaction } from '@libsql/client'
import { AsyncLocalStorage } from 'node:async_hooks'

type Name = 'session' | 'db' | 'render'

// A name's total counts the time at least one of its calls was open, so queries sent in
// parallel count once and no total exceeds the request's own time.
interface Span {
  total: number
  open: number
  since: number
}

const storage = new AsyncLocalStorage<Record<Name, Span>>()

function span(): Span {
  return { total: 0, open: 0, since: 0 }
}

// Runs fn with a fresh timer, which time() and serverTiming() inside it use.
export function withTiming<T>(fn: () => T): T {
  return storage.run({ session: span(), db: span(), render: span() }, fn)
}

// Outside withTiming(), as in tests and scripts, fn runs untimed.
export async function time<T>(name: Name, fn: () => Promise<T>): Promise<T> {
  const timed = storage.getStore()?.[name]
  if (!timed) return fn()
  if (timed.open++ === 0) timed.since = performance.now()
  try {
    return await fn()
  } finally {
    if (--timed.open === 0) timed.total += performance.now() - timed.since
  }
}

// The header's value for `names`.
export function serverTiming(names: Name[]): string {
  const timer = storage.getStore()
  if (!timer) throw new Error('Server-Timing read outside withTiming().')
  return names.map((name) => `${name};dur=${timer[name].total.toFixed(1)}`).join(', ')
}

// Times each method in `methods` as `db`, leaving the object's other members as they are.
function timedMethods<T extends object>(target: T, methods: string[]): T {
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object)
      if (typeof value !== 'function') return value
      if (typeof key === 'string' && methods.includes(key)) {
        return (...args: unknown[]) => time('db', () => value.apply(object, args))
      }
      return value.bind(object)
    },
  })
}

// The client with every statement, batch, and transaction step timed as `db`.
export function timedClient(client: Client): Client {
  const timed = timedMethods(client, ['execute', 'batch', 'executeMultiple'])
  return new Proxy(timed, {
    get(object, key) {
      if (key !== 'transaction') return Reflect.get(object, key, object)
      return async (...args: Parameters<Client['transaction']>) =>
        timedMethods<Transaction>(await time('db', () => client.transaction(...args)), [
          'execute',
          'batch',
          'executeMultiple',
          'commit',
          'rollback',
        ])
    },
  })
}
