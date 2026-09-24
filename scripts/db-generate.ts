// Creates an empty SQL migration, drizzle/<timestamp>_<name>/migration.sql, and deletes the
// snapshot.json drizzle-kit writes beside it. Migrations are hand-written, so the snapshots
// would stay empty and drizzle-kit needs them for nothing we use.
//
// Usage: bun run db:generate <name>

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'

const name = process.argv[2]
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('Usage: bun run db:generate <name>   (snake_case, e.g. add_project_color)')
  process.exit(1)
}

const result = spawnSync('bunx', ['--bun', 'drizzle-kit', 'generate', '--custom', '--name', name], {
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)

for (const folder of readdirSync('drizzle')) {
  const snapshot = `drizzle/${folder}/snapshot.json`
  if (existsSync(snapshot)) rmSync(snapshot)
}
