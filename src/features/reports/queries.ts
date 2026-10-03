// The Reports view's queries. Projects, teams and members come from the shared caches in
// src/lib/.
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/solid-query'
import { call } from '~/lib/api/client'
import { reportsKey } from '~/lib/queries/query'
import type {
  Report,
  ReportBreakdown,
  ReportEntries,
  ReportEntriesInput,
  ReportEntryTotalsInput,
  ReportInput,
} from '~/server/reports/reports.schemas'

export type { Report, ReportBreakdown, ReportEntries }

// The previous report stays on screen while the next filters load, so the grid doesn't
// flash empty between them.
export function reportQuery(organizationId: string, input: ReportInput) {
  return queryOptions({
    queryKey: [...reportsKey, organizationId, input],
    queryFn: () => call('getReport', { ...input, organizationId }),
    placeholderData: keepPreviousData,
  })
}

type EntriesPage = Pick<ReportEntriesInput, 'after' | 'offset'>
const FIRST_PAGE: EntriesPage = {}

// The Entries card's list, apart from the report so the timesheet never waits for it. By day
// loads a page at a time after the last piece shown; By description its top rows, then the
// rest.
export function reportEntriesQuery(
  organizationId: string,
  input: Omit<ReportEntriesInput, 'after' | 'offset'>,
) {
  return infiniteQueryOptions({
    queryKey: [...reportsKey, organizationId, 'entries', input],
    queryFn: ({ pageParam }) =>
      call('getReportEntries', { ...input, ...pageParam, organizationId }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page): EntriesPage | undefined => {
      if (page.next === null) return undefined
      return page.view === 'day' ? { after: page.next } : { offset: page.next }
    },
    placeholderData: keepPreviousData,
  })
}

// The Entries card's count and total for a part of the timesheet. The whole report's come
// with the report.
export function reportEntryTotalsQuery(organizationId: string, input: ReportEntryTotalsInput) {
  return queryOptions({
    queryKey: [...reportsKey, organizationId, 'entry-totals', input],
    queryFn: () => call('getReportEntryTotals', { ...input, organizationId }),
    placeholderData: keepPreviousData,
  })
}

// Breakdown's second level, which only that view loads. It totals the range, so the unit
// stays out of its key.
export function reportBreakdownQuery(organizationId: string, input: ReportInput) {
  const { unit: _, ...range } = input
  return queryOptions({
    queryKey: [...reportsKey, organizationId, 'breakdown', range],
    queryFn: () => call('getReportBreakdown', { ...range, organizationId }),
    placeholderData: keepPreviousData,
  })
}
