import { queryOptions } from '@tanstack/solid-query'
import { getLoginPolicy } from '~/server/auth/auth.functions'

export const loginPolicyQuery = queryOptions({
  queryKey: ['login-policy'],
  queryFn: () => getLoginPolicy(),
  staleTime: Infinity,
})
