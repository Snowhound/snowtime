// Task 081.30: whether GET /api/v1/session renews the session row and re-sends its cookie,
// on the TypeScript build and a native binary.
//   bun native/bench/audit/renewal.ts native/target/debug/snowtime-axum
import { createClient } from '@libsql/client'
import { join } from 'node:path'
import { startNative } from '../../../native/bench/native'
import { startApp } from '../../../perf/lib/app'
import { CACHE, SEED_NOW, USERS, seededDatabase } from '../../../perf/lib/database'

async function probe(label: string, app: { url: string; stop: () => Promise<void> }, db: string) {
  const r = await fetch(`${app.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: app.url },
    body: JSON.stringify(USERS.admin),
  })
  const cookie = r.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .join('; ')
  const token = decodeURIComponent(cookie.match(/session_token=([^;]+)/)![1]).split('.')[0]
  const client = createClient({ url: `file:${db}` })
  await client.execute({
    sql: 'update session set expires_at = ? where token = ?',
    args: [SEED_NOW.getTime() + 28 * 86_400_000, token],
  })
  const s = await fetch(`${app.url}/api/v1/session`, { headers: { cookie } })
  await s.text()
  const row = (
    await client.execute({ sql: 'select expires_at from session where token = ?', args: [token] })
  ).rows[0]
  client.close()
  console.log(
    `${label}: renewal ${new Date(Number(row.expires_at)).toISOString()}, set-cookie ${JSON.stringify(s.headers.getSetCookie().map((c) => c.replace(/=[^;]*/, '=…')))}`,
  )
  await app.stop()
}
const db = await seededDatabase()
const ts = await startApp({ database: db, env: { NODE_ENV: 'development' } })
await probe('typescript', ts, join(CACHE, `run-${new URL(ts.url).port}.db`))
const native = await startNative(process.argv[2], db)
await probe('native', native, join(CACHE, `native-${new URL(native.url).port}.db`))
process.exit(0)
