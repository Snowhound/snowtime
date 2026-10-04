import type * as v from 'valibot'
import {
  Report,
  ReportBreakdown,
  ReportEntries,
  type ReportEntriesInput,
  ReportEntryTotals,
  type ReportEntryTotalsInput,
  ReportExport,
  type ReportExportInput,
  type ReportInput,
} from '~/server/reports/reports.schemas'
import { request } from './request'

// Each call only reads; its filters travel as a JSON body, so it is a POST.
type In<S extends v.GenericSchema> = v.InferInput<S> & { organizationId: string }

function path(organizationId: string) {
  return `/api/v1/organizations/${organizationId}/report`
}

export function getReport({ organizationId, ...input }: In<typeof ReportInput>) {
  return request('POST', path(organizationId), input, Report)
}

// Breakdown's second level: time per project and member and per ticket and member.
export function getReportBreakdown({ organizationId, ...input }: In<typeof ReportInput>) {
  return request('POST', `${path(organizationId)}/breakdown`, input, ReportBreakdown)
}

// The Entries card's list: By description's merged rows, or one page of By day.
export function getReportEntries({ organizationId, ...input }: In<typeof ReportEntriesInput>) {
  return request('POST', `${path(organizationId)}/entries`, input, ReportEntries)
}

// The Entries card's count and total for one part of the timesheet.
export function getReportEntryTotals({
  organizationId,
  ...input
}: In<typeof ReportEntryTotalsInput>) {
  return request('POST', `${path(organizationId)}/entry-totals`, input, ReportEntryTotals)
}

// One month or less of the export's entries; the first piece brings the report as well.
export function getReportExport({ organizationId, ...input }: In<typeof ReportExportInput>) {
  return request('POST', `${path(organizationId)}/export`, input, ReportExport)
}
