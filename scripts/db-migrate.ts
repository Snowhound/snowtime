// Checks that applied migrations are unchanged (db-verify.ts), then applies pending ones. A
// script rather than a package.json chain because neither `bun run` nor bunx passes the .env
// files to drizzle-kit; spawned from here, it inherits the ones Bun loaded for this process.
//
// Usage: bun run db:migrate

import { spawnSync } from 'node:child_process'

for (const command of [
  ['bun', 'scripts/db-verify.ts'],
  ['bunx', '--bun', 'drizzle-kit', 'migrate'],
]) {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
