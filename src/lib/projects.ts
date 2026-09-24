// The organization's projects, as the timer, the entry dialog and the Projects view read
// them. They share one cache, so a change in Projects shows in the timer's pickers too.
import { queryOptions } from '@tanstack/solid-query'
import { listProjects } from '~/server/projects/projects.functions'

type ListedProject = Awaited<ReturnType<typeof listProjects>>[number]

// The fields the views read, so an optimistic project needs no audit columns.
export type Project = Pick<ListedProject, 'id' | 'name' | 'color' | 'archivedAt' | 'teamIds'>

// Archived projects too: entries keep theirs, the timer names them, and Projects lists
// them under Archived.
export function projectsQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['projects', organizationId, { includeArchived: true }],
    queryFn: (): Promise<Project[]> => listProjects({ data: { includeArchived: true } }),
  })
}
