// The libSQL client behind the app's database and test databases.
import { type Client, type Config, createClient, type Transaction } from '@libsql/client'

// How long a local file: database waits for another process's lock before failing with
// SQLITE_BUSY: db:seed, db:migrate, or the sqlite3 shell against the dev server's file.
// @libsql/client 0.18 can lose a connection's later writes after a SQLITE_BUSY (task
// 043), so waiting also keeps those writes. Remote Turso URLs ignore it.
const BUSY_TIMEOUT_MS = 5000

export function openClient(config: Config): Client {
  const client = createClient({ ...config, timeout: BUSY_TIMEOUT_MS })
  return config.url.startsWith('file:') ? oneAtATime(client) : client
}

// The client gives each transaction its own connection, so another request's write could
// meet the transaction's lock. The busy wait blocks the process, so the transaction can't
// commit, and the write fails with SQLITE_BUSY after BUSY_TIMEOUT_MS, which can lose that
// connection's later writes (task 043). Instead, every statement waits its turn while a
// transaction is open. Code inside a transaction must use its handle, never the client,
// or it waits for itself.
function oneAtATime(client: Client): Client {
  let queue = Promise.resolve()

  // Resolves once the caller's turn comes, with the function that ends it.
  function turn(): Promise<() => void> {
    let end!: () => void
    const ended = new Promise<void>((resolve) => (end = resolve))
    const started = queue.then(() => end)
    queue = queue.then(() => ended)
    return started
  }

  async function inTurn<T>(run: () => Promise<T>): Promise<T> {
    const end = await turn()
    try {
      return await run()
    } finally {
      end()
    }
  }

  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      if (key === 'transaction') {
        return async (...args: Parameters<Client['transaction']>) => {
          const end = await turn()
          try {
            return endingOnClose(await target.transaction(...args), end)
          } catch (error) {
            end()
            throw error
          }
        }
      }
      if (key === 'execute' || key === 'batch' || key === 'migrate' || key === 'executeMultiple') {
        return (...args: unknown[]) => inTurn(() => value.apply(target, args))
      }
      return value.bind(target)
    },
  })
}

// A transaction's turn lasts until it commits, rolls back, or closes.
function endingOnClose(transaction: Transaction, end: () => void): Transaction {
  return new Proxy(transaction, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      if (key !== 'commit' && key !== 'rollback' && key !== 'close') return value.bind(target)
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args)
        } finally {
          if (target.closed) end()
        }
      }
    },
  })
}
