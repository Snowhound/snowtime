import { authWritesFlow } from '../../conformance/auth-writes-flow'
import type { OAuthObservation } from '../../conformance/oauth-flow'
import { buildApp, startApp } from '../../perf/lib/app'
import { seededDatabase } from '../../perf/lib/database'
import { compareAuthWriteFixtures } from './auth-writes-fixtures'
import { startNative } from './native'

export async function compareAuthWrites(
  binary: string,
  database: string,
  judge: (label: string, a: OAuthObservation, b: OAuthObservation) => void,
) {
  const ts = await startApp({ database })
  let native: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    native = await startNative(binary, database)
    const observations: OAuthObservation[][] = [[], []]
    await authWritesFlow(ts, (r) => observations[0].push(r))
    await authWritesFlow(native, (r) => observations[1].push(r))
    if (observations[0].length !== observations[1].length)
      throw new Error('Auth writes comparison sequence differs')
    for (const [i, result] of observations[0].entries()) {
      const other = observations[1][i]
      if (other.label !== result.label) throw new Error('Auth writes comparison sequence differs')
      if (result.status !== result.expected || other.status !== other.expected)
        throw new Error(
          `Auth writes ${result.label}: ${result.status}/${other.status}, expected ${result.expected}`,
        )
      judge(`auth writes ${result.label}`, result, other)
    }
    await compareAuthWriteFixtures(binary, database, judge)
  } finally {
    await Promise.all([ts.stop(), native?.stop()])
  }
}
if (import.meta.main) {
  const [binary] = process.argv.slice(2)
  if (!binary) throw new Error('Usage: bun native/bench/auth-writes-compare.ts <native binary>')
  await buildApp()
  let differences = 0
  await compareAuthWrites(binary, await seededDatabase(), (label, a, b) => {
    const same = a.status === b.status && a.text === b.text
    if (!same) differences++
    console.log(`${same ? 'same bytes' : 'DIFFERENT'} ${label}`)
    if (!same) console.log(`  ts: ${a.status} ${a.text}\n  native: ${b.status} ${b.text}`)
  })
  process.exit(differences ? 1 : 0)
}
