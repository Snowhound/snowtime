import { queryOptions } from '@tanstack/solid-query'
import { getDeployment } from '~/server/auth/auth.functions'

// Fixed for the server's lifetime, so it loads once per page load. The sign-in page shows it.
export const deploymentQuery = queryOptions({
  queryKey: ['deployment'],
  queryFn: () => getDeployment(),
  staleTime: Infinity,
})
