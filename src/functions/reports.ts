// Report server functions. Thin wrappers: the rules live in src/server/reports.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '../db'
import { ReportInput } from '../schemas/reports'
import { scopeMiddleware } from '../server/middleware'
import * as reports from '../server/reports.server'

export const getReport = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportInput)
  .handler(({ data, context }) => reports.getReport(db, context.scope, data))
