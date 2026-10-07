import { queryOptions } from '@tanstack/solid-query'
import { getRunningTimer } from '~/lib/api/timer'

// The user's running timer spans organizations.
export const runningTimerQuery = queryOptions({
  queryKey: ['timer'],
  queryFn: () => getRunningTimer(),
})
