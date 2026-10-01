import { createClient } from '@libsql/client/web'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { chooseImportCleanup, importDatabase, localDatabasePath } from './import-database'

async function main() {
  const url = process.env.IMPORT_SOURCE_DATABASE_URL
  const authToken = process.env.IMPORT_SOURCE_AUTH_TOKEN
  const destinationUrl = process.env.TURSO_DATABASE_URL
  if (!url || !authToken || !destinationUrl) {
    throw new Error(
      'Set IMPORT_SOURCE_DATABASE_URL, IMPORT_SOURCE_AUTH_TOKEN, and TURSO_DATABASE_URL.',
    )
  }
  const remote = new URL(url)
  if (
    !['libsql:', 'https:'].includes(remote.protocol) ||
    remote.username ||
    remote.password ||
    remote.search ||
    remote.hash
  ) {
    throw new Error(
      'Use a libsql:// or https:// source URL with credentials only in IMPORT_SOURCE_AUTH_TOKEN.',
    )
  }
  if (process.env.DEMO_MODE === 'true') {
    throw new Error('Set DEMO_MODE=false before importing company data.')
  }
  if (!stdin.isTTY)
    throw new Error('Run the importer in an interactive terminal (docker compose run --rm -it).')
  const destination = localDatabasePath(destinationUrl)
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    console.log(`[db-import] Destination: ${destination}. The source database will only be read.`)
    console.log(`[db-import] Destination URL: ${process.env.BETTER_AUTH_URL ?? '(not set)'}`)
    const cleanup = await chooseImportCleanup((question) => prompt.question(question))
    if (!cleanup) {
      console.log('[db-import] Cancelled. No database was imported.')
      return
    }
    const source = createClient({ url, authToken, intMode: 'bigint' })
    try {
      const result = await source.execute(
        'SELECT id, name, slug FROM organization ORDER BY name, id',
      )
      const companies = result.rows.map((row) => {
        if (
          typeof row.id !== 'string' ||
          typeof row.name !== 'string' ||
          typeof row.slug !== 'string'
        ) {
          throw new Error('Invalid company data in the source database.')
        }
        return { id: row.id, name: row.name, slug: row.slug }
      })
      console.log('[db-import] Available companies:')
      companies.forEach((company, index) =>
        console.log(`  ${index + 1}. ${company.name} (${company.slug})`),
      )
      let organizationId: string | undefined
      for (;;) {
        const choice = (
          await prompt.question(
            'Choose a company number, or type ALL for every company (blank cancels): ',
          )
        ).trim()
        if (!choice) {
          console.log('[db-import] Cancelled. No database was imported.')
          return
        }
        if (choice === 'ALL') break
        const index = Number(choice) - 1
        if (Number.isInteger(index) && index >= 0 && index < companies.length) {
          organizationId = companies[index].id
          console.log(`[db-import] Selected company: ${companies[index].name}`)
          break
        }
      }
      console.log('[db-import] Cleanup:', cleanup)
      const confirmed = (
        await prompt.question(
          `${organizationId ? 'Import this company' : 'Import ALL companies'}? Type IMPORT to continue: `,
        )
      ).trim()
      if (confirmed !== 'IMPORT') {
        console.log('[db-import] Cancelled. No database was imported.')
        return
      }
      const counts = await importDatabase(
        source,
        destination,
        cleanup,
        process.env.MIGRATIONS_DIR,
        organizationId,
      )
      console.log('[db-import] Imported table counts:', counts)
      console.log(
        '[db-import] Integrity and foreign-key checks passed. The destination is ready for startup migration.',
      )
    } finally {
      source.close()
    }
  } finally {
    prompt.close()
  }
}

try {
  await main()
} catch (error) {
  const token = process.env.IMPORT_SOURCE_AUTH_TOKEN
  const message = error instanceof Error ? error.message : 'Import failed.'
  console.error(`[db-import] ${token ? message.replaceAll(token, '[redacted]') : message}`)
  process.exitCode = 1
}
