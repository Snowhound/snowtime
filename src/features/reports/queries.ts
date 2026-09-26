// The Reports view's queries. Projects, teams and members come from the shared caches in
// src/lib/.
import { keepPreviousData, queryOptions } from '@tanstack/solid-query'
import { reportsKey } from '~/lib/query'
import { getReport } from '~/server/reports/reports.functions'
import type { ReportInput } from '~/server/reports/reports.schemas'

export type Report = Awaited<ReturnType<typeof getReport>>

// The previous report stays on screen while the next filters load, so the grid doesn't
// flash empty between them.
export function reportQuery(organizationId: string, input: ReportInput) {
  return queryOptions({
    queryKey: [...reportsKey, organizationId, input],
    queryFn: () => getReport({ data: { ...input, organizationId } }),
    placeholderData: keepPreviousData,
  })
}
