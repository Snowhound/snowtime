// Timer server functions. Thin wrappers: the rules live in timer.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { scopeMiddleware, sessionMiddleware } from '../middleware'
import { StartTimerInput, StopTimerInput } from './timer.schemas'
import * as timer from './timer.server'

export const startTimer = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(StartTimerInput)
  .handler(({ data, context }) => timer.startTimer(db, context.scope, data))

// The running timer spans organizations, so stopping and reading it needs no active one.
export const stopTimer = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .validator(StopTimerInput)
  .handler(({ data, context }) => timer.stopTimer(db, context.userId, data))

export const getRunningTimer = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(({ context }) => timer.getRunningTimer(db, context.userId))
