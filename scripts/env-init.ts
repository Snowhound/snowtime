// Adds a generated BETTER_AUTH_SECRET to .env.local, creating the file if needed. It leaves a
// secret that is already set alone, so running it again doesn't sign everyone out. A script
// rather than a shell one-liner, so setup reads the same in cmd, PowerShell, and bash.
//
// Usage: bun run env:init

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const file = '.env.local'
const current = existsSync(file) ? readFileSync(file, 'utf8') : ''

if (/^BETTER_AUTH_SECRET=\S/m.test(current)) {
  console.log(`${file} already sets BETTER_AUTH_SECRET.`)
} else {
  const separator = current === '' || current.endsWith('\n') ? '' : '\n'
  appendFileSync(file, `${separator}BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}\n`)
  console.log(`Added BETTER_AUTH_SECRET to ${file}.`)
}
