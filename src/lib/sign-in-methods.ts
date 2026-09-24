import { queryOptions } from '@tanstack/solid-query'
import { getSignInMethods } from '~/server/auth/auth.functions'

// The environment's sign-in methods, for the sign-in screens and the settings list.
export const signInMethodsQuery = queryOptions({
  queryKey: ['sign-in-methods'],
  queryFn: () => getSignInMethods(),
  staleTime: Infinity,
})
