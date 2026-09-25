// The organization's members with their roles and teams, as Reports and Organization read
// them.
import { queryOptions } from '@tanstack/solid-query'
import { listMembers } from '~/server/teams/teams.functions'
import { ORGANIZATION_STALE_TIME } from './query'

export type Member = Awaited<ReturnType<typeof listMembers>>[number]

// Reconciled by user, so a changed member updates in place: its row, and the select just
// used in it, stay mounted and keep focus.
export function membersQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['members', organizationId],
    queryFn: () => listMembers(),
    reconcile: 'userId',
    staleTime: ORGANIZATION_STALE_TIME,
  })
}
