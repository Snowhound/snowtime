// Runs conformance tests against a native server: serves it a copy of the benchmark database
// with its clock at SEED_NOW and password sign-in on (conformance/server.ts), runs the tests
// with CONFORMANCE_URL, and stops it.
//
//   bun native/bench/conformance.ts native/target/release/snowtime-axum
//   bun native/bench/conformance.ts <binary> ./conformance/timer.conformance.ts

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { ROOT, seededDatabase } from '../../perf/lib/database'
import { startNative } from './native'

const [binary, ...files] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/conformance.ts <binary> [test files]')

const server = await startNative(binary, await seededDatabase())
let code = 1
try {
  const tests = (files.length > 0 ? files : ['./conformance/timer.conformance.ts']).map((file) =>
    resolve(ROOT, file),
  )
  code =
    spawnSync('bun', ['test', ...tests], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, CONFORMANCE_URL: server.url },
    }).status ?? 1
} finally {
  await server.stop()
}
process.exit(code)
