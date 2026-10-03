// Runs conformance tests against a native server: serves it a copy of the benchmark database
// with its clock at SEED_NOW and password sign-in on (conformance/server.ts), runs the tests
// with CONFORMANCE_URL, and stops it.
//
//   bun native/bench/conformance.ts native/target/release/snowtime-axum
//   bun native/bench/conformance.ts <binary> ./conformance/timer.conformance.ts

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, ROOT, SEED_NOW, seededDatabase } from '../../perf/lib/database'

const [binary, ...files] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/conformance.ts <binary> [test files]')

const port = 3190 + Math.floor(Math.random() * 100)
const url = `http://127.0.0.1:${port}`
const database = join(CACHE, `native-${port}.db`)
cpSync(await seededDatabase(), database)

const server = spawn(binary, [], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    PERF_NOW: String(SEED_NOW.getTime()),
    TURSO_DATABASE_URL: `file:${database}`,
    BETTER_AUTH_SECRET: 'perf-harness-secret-perf-harness-secret',
    BETTER_AUTH_URL: url,
  },
})

let code = 1
try {
  for (let waited = 0; ; waited += 100) {
    if (server.exitCode !== null) throw new Error(`[native] ${binary} exited ${server.exitCode}`)
    const ready = await fetch(`${url}/api/v1/availability`).then(
      (r) => r.ok,
      () => false,
    )
    if (ready) break
    if (waited > 10_000) throw new Error(`[native] ${binary} didn't answer in 10 s`)
    await Bun.sleep(100)
  }
  const tests = files.length > 0 ? files : ['./conformance/timer.conformance.ts']
  code =
    spawnSync('bun', ['test', ...tests], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, CONFORMANCE_URL: url },
    }).status ?? 1
} finally {
  server.kill()
  rmSync(database, { force: true })
  rmSync(`${database}-journal`, { force: true })
}
process.exit(code)
