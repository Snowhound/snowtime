import * as v from 'valibot'
import { Entry } from '~/server/entries/entries.schemas'
import {
  RunningTimer,
  type StartTimerInput,
  type StopTimerInput,
} from '~/server/timer/timer.schemas'
import { request } from './request'

// The running timer spans organizations, so reading and stopping it name none.
export function getRunningTimer() {
  return request('GET', '/api/v1/timer', undefined, v.nullable(RunningTimer))
}

export function startTimer({
  organizationId,
  ...input
}: v.InferInput<typeof StartTimerInput> & { organizationId: string }) {
  return request(
    'POST',
    `/api/v1/organizations/${organizationId}/timer/start`,
    input,
    v.object({ started: Entry, stopped: v.nullable(Entry) }),
  )
}

export function stopTimer(input: v.InferInput<typeof StopTimerInput>) {
  return request('POST', '/api/v1/timer/stop', input, Entry)
}
