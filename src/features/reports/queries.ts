// The Reports view's queries. Projects, teams and members come from the shared caches in
// src/lib/.
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/solid-query'
import { reportsKey } from '~/lib/queries/query'
import { getReport, getReportBreakdown, getReportEntries } from '~/server/reports/reports.functions'
import type { ReportEntriesInput, ReportInput } from '~/server/reports/reports.schemas'

export type Report = Awaited<ReturnType<typeof getReport>>
export type ReportEntries = Awaited<ReturnType<typeof getReportEntries>>
export type ReportBreakdown = Awaited<ReturnType<typeof getReportBreakdown>>

// The previous report stays on screen while the next filters load, so the grid doesn't
// flash empty between them.
export function reportQuery(organizationId: string, input: ReportInput) {
  return queryOptions({
    queryKey: [...reportsKey, organizationId, input],
    queryFn: () => getReport({ data: { ...input, organizationId } }),
    placeholderData: keepPreviousData,
  })
}

// The Entries card's list, apart from the report so the timesheet never waits for it. By
// description is one page; By day loads a page at a time after the last piece shown.
export function reportEntriesQuery(
  organizationId: string,
  input: Omit<ReportEntriesInput, 'after'>,
) {
  return infiniteQueryOptions({
    queryKey: [...reportsKey, organizationId, 'entries', input],
    queryFn: ({ pageParam }) =>
      getReportEntries({ data: { ...input, organizationId, after: pageParam } }),
    initialPageParam: undefined as ReportEntriesInput['after'],
    getNextPageParam: (page) => (page.view === 'day' ? (page.next ?? undefined) : undefined),
    placeholderData: keepPreviousData,
  })
}

// Breakdown's second level, which only that view loads. It totals the range, so the unit
// stays out of its key.
export function reportBreakdownQuery(organizationId: string, input: ReportInput) {
  const { unit: _, ...range } = input
  return queryOptions({
    queryKey: [...reportsKey, organizationId, 'breakdown', range],
    queryFn: () => getReportBreakdown({ data: { ...range, organizationId } }),
    placeholderData: keepPreviousData,
  })
}
