// Report server functions. Thin wrappers: the rules live in reports.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { scopeMiddleware } from '../middleware'
import { ReportInput } from './reports.schemas'
import * as reports from './reports.server'

export const getReport = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ReportInput)
  .handler(({ data, context }) => reports.getReport(db, context.scope, data))
