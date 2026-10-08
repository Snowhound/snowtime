// Makes independent local review copies with a new-member and an existing-member link.
import { createClient } from '@libsql/client'
import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { COMPANY, USERS, seededDatabase } from '../../perf/lib/database'
import { companyIds } from '../../src/db/seed-company'

const source = await seededDatabase()
const ids = ['01900000-0000-7000-8031-000000000001', '01900000-0000-7000-8031-000000000002']
for (const name of ['ts', 'native']) {
  const file = resolve(`perf/.cache/auth-review-${name}.db`)
  if (existsSync(file))
    throw new Error(`${file} already exists; choose fresh filenames before repeating`)
  cpSync(source, file)
  const db = createClient({ url: `file:${file}` })
  try {
    const inviter = (
      await db.execute({ sql: 'select id from user where email=?', args: [USERS.admin.email] })
    ).rows[0].id
    for (const [i, email] of ['noah@example.com', USERS.admin.email].entries()) {
      await db.execute({
        sql: 'insert into invitation (id,email,role,organization_id,inviter_id,status,expires_at,created_at,team_id) values (?,?,?,?,?,?,?,?,?)',
        args: [
          ids[i],
          email,
          'member',
          COMPANY.id,
          inviter,
          'pending',
          Date.now() + 48 * 60 * 60 * 1000,
          Date.now(),
          companyIds.teams.design,
        ],
      })
    }
  } finally {
    db.close()
  }
  const url = name === 'ts' ? 'http://localhost:3100' : 'http://127.0.0.1:3200'
  console.log(`${name}: ${file}`)
  for (const [i, email] of ['noah@example.com', USERS.admin.email].entries())
    console.log(`${email}: ${url}/invitation/${ids[i]}`)
}
