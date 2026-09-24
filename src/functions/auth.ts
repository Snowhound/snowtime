// Sign-in server functions. Thin wrappers: the rules live in src/server/sign-in.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { env } from '../env'
import { signInMethods } from '../server/sign-in.server'

// The sign-in view calls this signed out, so it has no session or scope middleware. It
// returns method ids only, never a client ID or secret.
export const getSignInMethods = createServerFn({ method: 'GET' }).handler(() =>
  signInMethods(env),
)
