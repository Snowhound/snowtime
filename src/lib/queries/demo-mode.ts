import { queryOptions } from '@tanstack/solid-query'
import { getDemoMode } from '~/server/auth/auth.functions'

export const demoModeQuery = queryOptions({
  queryKey: ['demo-mode'],
  queryFn: () => getDemoMode(),
  staleTime: Infinity,
})
