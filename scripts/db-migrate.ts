// Checks that applied migrations are unchanged (db-verify.ts), then applies pending ones. A
// script rather than a package.json chain because neither `bun run` nor bunx passes the .env
// files to drizzle-kit; spawned from here, it inherits the ones Bun loaded for this process.
// drizzle-kit runs on this Bun directly: on a server without Node, bunx failed for a user
// that doesn't own the checkout, such as the app's own (docs/deployment/self-hosted.md).
//
// Usage: bun run db:migrate

import { spawnSync } from 'node:child_process'

for (const command of [
  [process.execPath, 'scripts/db-verify.ts'],
  [process.execPath, 'node_modules/drizzle-kit/bin.cjs', 'migrate'],
]) {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
