// A database and environment for checking ALLOWED_LOGIN_DOMAINS after the list narrows: the
// seeded owner (lumen.example.com) keeps a session from before, while the list now names
// only example.com, whose seeded user is noah@example.com.
import { createClient } from '@libsql/client'
import { createHmac } from 'node:crypto'
import { cpSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, SEED_NOW, USERS } from '../perf/lib/database'

export const LOGIN_DOMAINS_ENV = { ALLOWED_LOGIN_DOMAINS: 'example.com' }
export const ALLOWED_USER = { email: 'noah@example.com', password: USERS.admin.password }

const TOKEN = 'login-domain-blocked'
// Signed as Better Auth signs the session cookie, with the harnesses' secret.
export const BLOCKED_COOKIE = `better-auth.session_token=${encodeURIComponent(
  `${TOKEN}.${createHmac('sha256', 'perf-harness-secret-perf-harness-secret').update(TOKEN).digest('base64')}`,
)}`

// A copy of `seed` with the owner's session.
export async function loginDomainsDatabase(seed: string) {
  const copy = join(mkdtempSync(join(CACHE, 'login-domains-')), 'seed.db')
  cpSync(seed, copy)
  const db = createClient({ url: `file:${copy}` })
  try {
    const now = SEED_NOW.getTime()
    await db.execute({
      sql: 'insert into session (id, user_id, token, expires_at, created_at, updated_at) select ?, id, ?, ?, ?, ? from user where email = ?',
      args: [TOKEN, TOKEN, now + 86_400_000, now, now, USERS.admin.email],
    })
  } finally {
    db.close()
  }
  return copy
}
