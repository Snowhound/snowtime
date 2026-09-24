import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/solid'
import { organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [organizationClient({ teams: { enabled: true } }), passkeyClient()],
})
