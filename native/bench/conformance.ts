// Runs conformance tests against a native server: serves it a copy of the benchmark database
// with its clock at SEED_NOW and password sign-in on (conformance/server.ts), runs the tests
// with CONFORMANCE_URL, and stops it.
//
//   bun native/bench/conformance.ts native/target/release/snowtime-axum
//   bun native/bench/conformance.ts <binary> ./conformance/timer.conformance.ts

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { oauthEnv, startOAuthProvider } from '../../conformance/oauth-provider'
import { ROOT, seededDatabase } from '../../perf/lib/database'
import { startNative } from './native'

const [binary, ...files] = process.argv.slice(2)
if (!binary) throw new Error('Usage: bun native/bench/conformance.ts <binary> [test files]')

const provider = files.some((file) => file.includes('oauth.conformance'))
  ? startOAuthProvider()
  : undefined
const server = await startNative(
  binary,
  await seededDatabase(),
  provider ? oauthEnv(provider.url) : {},
)
let code = 1
try {
  const tests = (files.length > 0 ? files : ['./conformance/timer.conformance.ts']).map((file) =>
    resolve(ROOT, file),
  )
  code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      'bun',
      [
        'test',
        ...tests,
        ...(process.env.CONFORMANCE_TEST_NAME_PATTERN
          ? ['-t', process.env.CONFORMANCE_TEST_NAME_PATTERN]
          : []),
      ],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          CONFORMANCE_URL: server.url,
          ...(provider ? { OAUTH_FAKE_PROVIDER: provider.url } : {}),
        },
      },
    )
    child.once('error', reject)
    child.once('exit', (status) => resolve(status ?? 1))
  })
} finally {
  await server.stop()
  await provider?.stop()
}
process.exit(code)
