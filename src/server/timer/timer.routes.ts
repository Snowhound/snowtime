import { Hono } from 'hono'
import { input, keys, type OrganizationEnv, run, type UserEnv } from '../http.server'
import { StartTimerInput, StopTimerInput } from './timer.schemas'
import * as timer from './timer.server'

// The running timer spans organizations, so reading and stopping it name none.
export const timerRoutes = new Hono<UserEnv>()
  .get('/timer', keys, (c) => run(c, timer.getRunningTimer))
  .post('/timer/stop', keys, input(StopTimerInput), (c) => run(c, timer.stopTimer))

export const organizationTimerRoutes = new Hono<OrganizationEnv>().post(
  '/timer/start',
  keys,
  input(StartTimerInput),
  (c) => run(c, timer.startTimer),
)
