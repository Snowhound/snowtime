// The organization's projects, as the timer, the entry popover and the Projects view read
// them. They share one cache, so a change in Projects shows in the timer's pickers too.
import { queryOptions } from '@tanstack/solid-query'
import { call } from '~/lib/api/client'
import type { ListedProject } from '~/server/projects/projects.schemas'
import { ORGANIZATION_STALE_TIME } from './query'

export type Project = ListedProject

// Archived projects too: entries keep theirs, the timer names them, and Projects lists
// them under Archived.
export function projectsQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['projects', organizationId, { includeArchived: true }],
    queryFn: () => call('listProjects', { organizationId, includeArchived: true }),
    staleTime: ORGANIZATION_STALE_TIME,
  })
}
