// The organization's teams with their members' team roles, as Projects and Reports read
// them.
import { queryOptions } from '@tanstack/solid-query'
import { listTeams } from '~/server/teams/teams.functions'

export type Team = Awaited<ReturnType<typeof listTeams>>[number]

// Reconciled by id, so a changed team updates in place and its card keeps focus.
export function teamsQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['teams', organizationId],
    queryFn: () => listTeams(),
    reconcile: 'id',
  })
}
