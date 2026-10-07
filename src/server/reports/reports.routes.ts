import { Hono } from 'hono'
import { input, type OrganizationEnv, reads, run } from '../http.server'
import {
  ReportEntriesInput,
  ReportEntryTotalsInput,
  ReportExportInput,
  ReportInput,
} from './reports.schemas'
import * as reports from './reports.server'

// Each call reads, with the report's filters as a JSON body.
export const reportRoutes = new Hono<OrganizationEnv>()
  .post('/report', reads, input(ReportInput), (c) => run(c, reports.getReport))
  // Breakdown's second level: time per project and member and per ticket and member.
  .post('/report/breakdown', reads, input(ReportInput), (c) => run(c, reports.getReportBreakdown))
  // The Entries card's list: By description's merged rows, or one page of By day.
  .post('/report/entries', reads, input(ReportEntriesInput), (c) =>
    run(c, reports.getReportEntries),
  )
  // The Entries card's count and total for one part of the timesheet.
  .post('/report/entry-totals', reads, input(ReportEntryTotalsInput), (c) =>
    run(c, reports.getReportEntryTotals),
  )
  // One month or less of the export's entries; the first piece brings the report as well.
  .post('/report/export', reads, input(ReportExportInput), (c) => run(c, reports.getReportExport))
