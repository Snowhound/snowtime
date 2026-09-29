// Report server functions. Thin wrappers: the rules live in reports.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { scopeMiddleware } from '../middleware'
import { ReportEntriesInput, ReportEntryTotalsInput, ReportInput } from './reports.schemas'
import * as reports from './reports.server'

export const getReport = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportInput)
  .handler(({ data, context }) => reports.getReport(db, context.scope, data))

// The report and the entries behind it, from one read, for its export.
export const getReportExport = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportInput)
  .handler(({ data, context }) => reports.getReportExport(db, context.scope, data))

// The Entries card's list: By description's merged rows, or one page of By day.
export const getReportEntries = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportEntriesInput)
  .handler(({ data, context }) => reports.getReportEntries(db, context.scope, data))

// The Entries card's count and total for one part of the timesheet.
export const getReportEntryTotals = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportEntryTotalsInput)
  .handler(({ data, context }) => reports.getReportEntryTotals(db, context.scope, data))

// Breakdown's second level: time per project and member and per ticket and member.
export const getReportBreakdown = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportInput)
  .handler(({ data, context }) => reports.getReportBreakdown(db, context.scope, data))
