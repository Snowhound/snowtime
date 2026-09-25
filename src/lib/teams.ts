// The organization's teams with their members' team roles, as Projects and Reports read
// them.
import { queryOptions } from '@tanstack/solid-query'
import { listTeams } from '~/server/teams/teams.functions'
import { ORGANIZATION_STALE_TIME } from './query'

export type Team = Awaited<ReturnType<typeof listTeams>>[number]

// Reconciled by id, so a changed team updates in place and its card keeps focus.
export function teamsQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['teams', organizationId],
    queryFn: () => listTeams(),
    reconcile: 'id',
    staleTime: ORGANIZATION_STALE_TIME,
  })
}
