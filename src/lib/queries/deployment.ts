import { queryOptions } from '@tanstack/solid-query'
import { call } from '~/lib/api/client'

// Fixed for the server's lifetime, so it loads once per page load. The sign-in page shows it.
export const deploymentQuery = queryOptions({
  queryKey: ['deployment'],
  queryFn: () => call('getDeployment'),
  staleTime: Infinity,
})
