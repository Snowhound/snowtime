import { oauthFlow, type OAuthObservation } from '../../conformance/oauth-flow'
import { oauthEnv, startOAuthProvider } from '../../conformance/oauth-provider'
import { buildApp, startApp } from '../../perf/lib/app'
import { seededDatabase } from '../../perf/lib/database'
import { startNative } from './native'
import { compareOAuthFixtures } from './oauth-fixtures'

export async function compareOAuth(
  binary: string,
  database: string,
  judge: (label: string, a: OAuthObservation, b: OAuthObservation) => void,
) {
  const provider = startOAuthProvider()
  const ts = await startApp({ database, env: oauthEnv(provider.url) })
  let native: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    native = await startNative(binary, database, oauthEnv(provider.url))
    const observations: OAuthObservation[][] = [[], []]
    await oauthFlow(ts, provider.url, (r) => observations[0].push(r))
    await oauthFlow(native, provider.url, (r) => observations[1].push(r))
    for (const [i, result] of observations[0].entries()) {
      const other = observations[1][i]
      if (!other || other.label !== result.label)
        throw new Error('OAuth comparison sequence differs')
      judge(`oauth ${result.label}`, result, other)
    }
    await compareOAuthFixtures(binary, database, judge)
  } finally {
    await Promise.all([ts.stop(), native?.stop()])
    await provider.stop()
  }
}
if (import.meta.main) {
  const [binary] = process.argv.slice(2)
  if (!binary) throw new Error('Usage: bun native/bench/oauth-compare.ts <native binary>')
  await buildApp()
  let differences = 0
  await compareOAuth(binary, await seededDatabase(), (label, a, b) => {
    const same = a.status === b.status && a.text === b.text
    if (!same) differences++
    console.log(`${same ? 'same bytes' : 'DIFFERENT'} ${label}`)
    if (!same) console.log(`  ts: ${a.status} ${a.text}\n  native: ${b.status} ${b.text}`)
  })
  process.exit(differences ? 1 : 0)
}
