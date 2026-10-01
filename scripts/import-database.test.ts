import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, unlinkSync } from 'node:fs'
import { seed, seedIds } from '~/db/seed'
import { companyIds, seedCompany } from '~/db/seed-company'
import { createTestDatabase } from '~/db/testing'
import { chooseImportCleanup, importDatabase, localDatabasePath } from './import-database'

test('imports one company without shared users other company records, preserves audits and refuses overwrite', async () => {
  const fixture = await createTestDatabase()
  const destination = localDatabasePath(fixture.url) + '.imported'
  let target: Database | undefined
  try {
    await seed(fixture.db)
    const counts = await importDatabase(
      fixture.db.$client,
      destination,
      {
        clearSessions: true,
        clearPasskeys: true,
        clearProviderTokens: true,
      },
      'drizzle',
      seedIds.orgs.northwind,
    )
    expect(counts.organization).toBe(1)
    target = new Database(destination)
    expect(target.query('SELECT id FROM organization').all()).toEqual([
      { id: seedIds.orgs.northwind },
    ])
    for (const table of ['member', 'team', 'project', 'project_team', 'time_entry', 'invitation']) {
      expect(
        target
          .query(`SELECT count(*) AS count FROM ${table} WHERE organization_id != ?`)
          .get(seedIds.orgs.northwind),
      ).toEqual({ count: 0 })
    }
    expect(
      target.query('SELECT id FROM time_entry WHERE id = ?').get(seedIds.entries.harbor),
    ).toBeNull()
    expect(target.query('PRAGMA foreign_key_check').all()).toEqual([])
    expect(target.query('SELECT count(*) AS count FROM account').get()).toEqual({ count: 7 })
    const original = await fixture.db.$client.execute({
      sql: 'SELECT id, created_by, updated_by, created_at, updated_at FROM time_entry WHERE organization_id = ? ORDER BY id',
      args: [seedIds.orgs.northwind],
    })
    expect(
      target
        .query(
          'SELECT id, created_by, updated_by, created_at, updated_at FROM time_entry ORDER BY id',
        )
        .all(),
    ).toEqual(original.rows.map((row) => ({ ...row })))
    await expect(
      importDatabase(fixture.db.$client, destination, {
        clearSessions: false,
        clearPasskeys: false,
        clearProviderTokens: false,
      }),
    ).rejects.toThrow('already exists')
  } finally {
    target?.close()
    if (existsSync(destination)) unlinkSync(destination)
    await fixture.cleanup()
  }
})

test('cancel and hostname choices determine cleanup defaults', async () => {
  expect(await chooseImportCleanup(async () => '')).toBeNull()
  const answers = ['yes', 'different', '', '', '']
  expect(await chooseImportCleanup(async () => answers.shift() ?? '')).toEqual({
    clearSessions: true,
    clearPasskeys: true,
    clearProviderTokens: true,
  })
})

test('imports the full year and optionally preserves or clears authentication state', async () => {
  const fixture = await createTestDatabase()
  const paths = [
    localDatabasePath(fixture.url) + '.kept',
    localDatabasePath(fixture.url) + '.cleared',
  ]
  try {
    await seed(fixture.db)
    await seedCompany(fixture.db)
    await fixture.db.$client.execute({
      sql: "UPDATE account SET access_token = 'sample-token', refresh_token = 'sample-refresh', id_token = 'sample-id', access_token_expires_at = 123 WHERE user_id = ?",
      args: [seedIds.users.owner],
    })
    await fixture.db.$client.execute({
      sql: "INSERT INTO passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('sample-key', 'public', ?, 'credential', 0, 'singleDevice', 0)",
      args: [seedIds.users.owner],
    })
    for (const [index, destination] of paths.entries()) {
      const clear = index === 1
      const counts = await importDatabase(fixture.db.$client, destination, {
        clearSessions: clear,
        clearPasskeys: clear,
        clearProviderTokens: clear,
      })
      expect(counts.organization).toBe(3)
      expect(counts.time_entry).toBeGreaterThan(19000)
      const target = new Database(destination)
      try {
        expect(
          target
            .query('SELECT count(*) AS count FROM time_entry WHERE organization_id = ?')
            .get(companyIds.org),
        ).toEqual({
          count: Number(
            (
              await fixture.db.$client.execute({
                sql: 'SELECT count(*) AS count FROM time_entry WHERE organization_id = ?',
                args: [companyIds.org],
              })
            ).rows[0].count,
          ),
        })
        expect(counts.passkey).toBe(clear ? 0 : 1)
        expect(
          target
            .query(
              'SELECT access_token, refresh_token, id_token, access_token_expires_at FROM account WHERE user_id = ?',
            )
            .get(seedIds.users.owner),
        ).toEqual({
          access_token: clear ? null : 'sample-token',
          refresh_token: clear ? null : 'sample-refresh',
          id_token: clear ? null : 'sample-id',
          access_token_expires_at: clear ? null : 123,
        })
        expect(
          target.query('SELECT password FROM account WHERE user_id = ?').get(seedIds.users.owner),
        ).toBeTruthy()
      } finally {
        target.close()
      }
    }
  } finally {
    for (const path of paths) if (existsSync(path)) unlinkSync(path)
    await fixture.cleanup()
  }
}, 15000)
