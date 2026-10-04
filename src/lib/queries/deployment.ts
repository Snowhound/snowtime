import { queryOptions } from '@tanstack/solid-query'
import { getDeployment } from '~/lib/api/auth'

// Fixed for the server's lifetime, so it loads once per page load. The sign-in page shows it.
export const deploymentQuery = queryOptions({
  queryKey: ['deployment'],
  queryFn: () => getDeployment(),
  staleTime: Infinity,
})
