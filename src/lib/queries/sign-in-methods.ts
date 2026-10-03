import { queryOptions } from '@tanstack/solid-query'
import { call } from '~/lib/api/client'

// The environment's sign-in methods, for the sign-in screens and the settings list.
export const signInMethodsQuery = queryOptions({
  queryKey: ['sign-in-methods'],
  queryFn: () => call('getSignInMethods'),
  staleTime: Infinity,
})
