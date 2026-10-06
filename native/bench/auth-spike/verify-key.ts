import { apiKey, defaultKeyHasher } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { Database } from 'bun:sqlite'
import { strict as assert } from 'node:assert'
import { readdirSync } from 'node:fs'

const { key, row } = JSON.parse(process.argv[2])
assert.equal(await defaultKeyHasher(key), row.key)
const db = new Database(':memory:')
db.exec(await Bun.file(new URL('./api-key.sql', import.meta.url)).text())
const migrations = new URL('../../../drizzle/', import.meta.url)
for (const folder of readdirSync(migrations).sort()) {
  const file = Bun.file(new URL(`${folder}/migration.sql`, migrations))
  if (await file.exists()) db.exec(await file.text())
}
db.query(
  'INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?, ?, ?, 1, ?, ?)',
).run(row.referenceId, 'Alice', 'key@example.com', Date.now(), Date.now())
function snake(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}
const fields = Object.keys(row)
  .filter((key) => key !== 'id')
  .map((key) => [key, snake(key)])
const columns = ['id', ...fields.map(([, column]) => column)]
const values = ['id', ...fields.map(([key]) => key)].map((name) => {
  const value = row[name]
  if (['createdAt', 'updatedAt', 'expiresAt', 'lastRequest', 'lastRefillAt'].includes(name))
    return value === null ? null : new Date(value).getTime()
  return typeof value === 'boolean' ? Number(value) : value
})
// Reset the deliberately exhausted Rust test counter for the independent TS verification.
values[columns.indexOf('request_count')] = 0
values[columns.indexOf('last_request')] = null
const placeholders = columns.map(() => '?').join(',')
db.query(`INSERT INTO api_key (${columns.join(',')}) VALUES (${placeholders})`).run(...values)
const auth = betterAuth({
  secret: 'spike-secret-for-better-auth-compatibility-081',
  baseURL: 'http://localhost:3100',
  database: db,
  user: {
    fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
  session: {
    fields: Object.fromEntries(
      ['userId', 'expiresAt', 'ipAddress', 'userAgent', 'createdAt', 'updatedAt'].map((name) => [
        name,
        snake(name),
      ]),
    ),
  },
  account: {
    fields: Object.fromEntries(
      [
        'userId',
        'accountId',
        'providerId',
        'accessToken',
        'refreshToken',
        'idToken',
        'accessTokenExpiresAt',
        'refreshTokenExpiresAt',
        'createdAt',
        'updatedAt',
      ].map((name) => [name, snake(name)]),
    ),
  },
  verification: {
    fields: Object.fromEntries(
      ['expiresAt', 'createdAt', 'updatedAt'].map((name) => [name, snake(name)]),
    ),
  },
  plugins: [
    apiKey({
      defaultPrefix: 'snow_',
      requireName: true,
      enableSessionForAPIKeys: false,
      startingCharactersConfig: { shouldStore: false },
      schema: { apikey: { modelName: 'api_key', fields: Object.fromEntries(fields) } },
    }),
  ],
})
const verified = await auth.api.verifyApiKey({ body: { key } })
assert.equal(verified.valid, true)
const created = await auth.api.createApiKey({
  body: { userId: row.referenceId, name: 'TS scoped key', permissions: { api: ['read', 'write'] } },
})
assert.match(created.key, /^snow_[A-Za-z0-9]{64}$/)
assert.equal(created.key.length, key.length)
const tsRow = db.query('SELECT key, permissions FROM api_key WHERE id = ?').get(created.id) as {
  key: string
  permissions: string
}
assert.equal(tsRow.key, await defaultKeyHasher(created.key))
console.log(
  JSON.stringify({
    verifiedRustKey: verified.valid,
    tsKey: created.key,
    tsHash: tsRow.key,
    permissions: tsRow.permissions,
  }),
)
