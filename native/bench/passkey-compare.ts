import { PasskeyAuthenticator } from '../../conformance/passkey-authenticator'
import { passkeyFlow, type PasskeyObservation } from '../../conformance/passkey-flow'
import { buildApp, startApp } from '../../perf/lib/app'
import { seededDatabase } from '../../perf/lib/database'
import { startNative } from './native'
import { comparePasskeyFixtures } from './passkey-fixtures'

export async function comparePasskeys(
  binary: string,
  database: string,
  judge: (label: string, a: PasskeyObservation, b: PasskeyObservation) => void,
) {
  const ts = await startApp({ database, env: { CLIENT_IP_HEADER: 'x-bench-ip' } })
  let native: Awaited<ReturnType<typeof startNative>> | undefined
  try {
    native = await startNative(binary, database, { CLIENT_IP_HEADER: 'x-bench-ip' })
    const authenticators = [
      new PasskeyAuthenticator('ES256'),
      new PasskeyAuthenticator('EdDSA'),
      new PasskeyAuthenticator('RS256'),
    ]
    const observations: PasskeyObservation[][] = [[], []]
    await passkeyFlow(ts, authenticators, (result) => observations[0].push(result))
    await passkeyFlow(native, authenticators, (result) => observations[1].push(result))
    for (const [i, result] of observations[0].entries()) {
      const other = observations[1][i]
      if (!other || other.label !== result.label)
        throw new Error('Passkey comparison sequence differs')
      judge(`passkeys ${result.label}`, result, other)
    }
    await comparePasskeyFixtures(binary, database, judge)
  } finally {
    await Promise.all([ts.stop(), native?.stop()])
  }
}

if (import.meta.main) {
  const [binary] = process.argv.slice(2)
  if (!binary) throw new Error('Usage: bun native/bench/passkey-compare.ts <native binary>')
  await buildApp()
  let differences = 0
  await comparePasskeys(binary, await seededDatabase(), (label, a, b) => {
    const same = a.status === b.status && a.text === b.text
    if (!same) differences++
    console.log(`${same ? 'same bytes' : 'DIFFERENT'} ${label}`)
    if (!same) console.log(`  ts: ${a.text}\n  native: ${b.text}`)
  })
  process.exit(differences ? 1 : 0)
}
