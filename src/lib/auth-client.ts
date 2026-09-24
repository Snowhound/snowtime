import { passkeyClient } from '@better-auth/passkey/client'
import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/solid'

export const authClient = createAuthClient({
  plugins: [organizationClient({ teams: { enabled: true } }), passkeyClient()],
})

// Better Auth's client calls resolve to { data, error }; queries and mutations want a
// throw. The thrown error carries Better Auth's `code`, which errorMessage
// (src/lib/errors.ts) names.
export async function unwrap<T>(call: Promise<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await call
  if (error || data === null) throw error ?? new Error('No data')
  return data
}
