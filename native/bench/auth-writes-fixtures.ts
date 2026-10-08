import { createClient } from '@libsql/client'
import { createHmac } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OAuthObservation } from '../../conformance/oauth-flow'
import { startApp } from '../../perf/lib/app'
import { COMPANY, SEED_NOW, USERS } from '../../perf/lib/database'
import { startNative } from './native'

export async function compareAuthWriteFixtures(
  binary: string,
  database: string,
  judge: (label: string, a: OAuthObservation, b: OAuthObservation) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'snowtime-auth-write-fixtures-'))
  const copy = join(directory, 'seed.db')
  cpSync(database, copy)
  const db = createClient({ url: `file:${copy}` })
  try {
    const admin = (
      await db.execute({ sql: 'select id from user where email=?', args: [USERS.admin.email] })
    ).rows[0].id!
    const member = (
      await db.execute({
        sql: 'select id from member where user_id=(select id from user where email=?) and organization_id=?',
        args: [USERS.member.email, COMPANY.id],
      })
    ).rows[0].id!
    const now = SEED_NOW.getTime()
    for (const [token, expires] of [
      ['stale-write', now + 86400000],
      ['expired-write', now - 1],
    ] as const) {
      await db.execute({
        sql: 'insert into session(id,user_id,token,expires_at,created_at,updated_at,active_organization_id) values (?,?,?,?,?,?,?)',
        args: [token, admin, token, expires, now - 86400001, now, COMPANY.id],
      })
    }
    db.close()
    const bodies: [string, unknown][] = [
      ['/update-user', { name: 'Stale profile' }],
      ['/organization/set-active', { organizationId: COMPANY.id }],
      ['/organization/check-slug', { slug: 'fixture-free' }],
      ['/organization/create', { name: ' ', slug: 'fixture-create' }],
      ['/organization/update', { data: { name: 'Lumen Works' } }],
      ['/organization/update-member-role', { memberId: member, role: 'member' }],
      ['/organization/remove-member', { memberIdOrEmail: 'missing' }],
      ['/organization/cancel-invitation', { invitationId: 'missing' }],
    ]
    for (const mode of ['stale', 'expired', 'restricted'] as const) {
      const env: Record<string, string> =
        mode === 'restricted' ? { ALLOWED_LOGIN_DOMAINS: 'example.com' } : {}
      const ts = await startApp({ database: copy, env })
      let native: Awaited<ReturnType<typeof startNative>> | undefined
      try {
        native = await startNative(binary, copy, env)
        const token = mode === 'expired' ? 'expired-write' : 'stale-write'
        const signed = `${token}.${createHmac('sha256', 'perf-harness-secret-perf-harness-secret').update(token).digest('base64')}`
        const cookie = `better-auth.session_token=${encodeURIComponent(signed)}`
        for (const [path, body] of bodies) {
          const responses: OAuthObservation[] = []
          for (const app of [ts, native]) {
            const response = await fetch(`${app.url}/api/auth${path}`, {
              method: 'POST',
              headers: { cookie, origin: app.url, 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            const expected =
              mode === 'restricted'
                ? 403
                : mode === 'expired'
                  ? 401
                  : path === '/organization/create' ||
                      path === '/organization/remove-member' ||
                      path === '/organization/cancel-invitation'
                    ? 400
                    : 200
            responses.push({
              label: `${mode} ${path}`,
              status: response.status,
              expected,
              text: await response.text(),
            })
          }
          for (const r of responses)
            if (r.status !== r.expected)
              throw new Error(`${r.label}: ${r.status}, expected ${r.expected}: ${r.text}`)
          judge(`auth write fixture ${mode} ${path}`, responses[0], responses[1])
        }
      } finally {
        await Promise.all([ts.stop(), native?.stop()])
      }
    }
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
