import { queryOptions } from '@tanstack/solid-query'
import { isServer } from 'solid-js/web'
import { authClient, unwrap } from './auth-client'

// The user's passkeys, for the settings list and the app frame's prompt to add one. It
// runs in the browser: the Better Auth client can't call itself during server rendering.
export const passkeysQuery = queryOptions({
  queryKey: ['auth', 'passkeys'],
  queryFn: () => unwrap(authClient.passkey.listUserPasskeys()),
  enabled: !isServer,
})

// Better Auth lets a session add a passkey for a day after sign-in (its `freshAge`).
export const FRESH_SESSION_MS = 24 * 60 * 60 * 1000
