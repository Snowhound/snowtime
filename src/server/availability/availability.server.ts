import { sql } from 'drizzle-orm'
import type { Database } from '~/db'

// Long enough for a slow round trip to Turso, short enough that a request made during an
// outage fails soon rather than at the platform's timeout.
const PROBE_TIMEOUT_MS = 3000

// Whether the database answers a trivial query. False while it is unreachable, rejects the
// token, or doesn't answer in time.
export async function databaseAvailable(database: Database): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, PROBE_TIMEOUT_MS, false)
  })
  const probe = database.run(sql`select 1`).then(
    () => true,
    () => false,
  )
  try {
    return await Promise.race([probe, timeout])
  } finally {
    clearTimeout(timer)
  }
}
