import { passkeyClient } from '@better-auth/passkey/client'
import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/solid'

export const authClient = createAuthClient({
  plugins: [organizationClient({ teams: { enabled: true } }), passkeyClient()],
})
