// The contract's calls by name (task 084): how the JSON API addresses each one, and the
// schemas of what it takes and returns. Both backends serve each one, and the client module
// reaches them through one transport. Only the API's and the host's transports import this
// file, so the TypeScript app's client bundle leaves it out.
import * as v from 'valibot'
import {
  CreateEntryInput,
  DeleteEntryInput,
  Entry,
  GetFirstEntryStartInput,
  ListEntriesInput,
  UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import { type Operation, Timestamp } from '~/server/schemas'
import { RunningTimer, StartTimerInput, StopTimerInput } from '~/server/timer/timer.schemas'

const entriesPath = '/api/v1/organizations/:organizationId/entries'

export const operations = {
  // The running timer spans organizations, so stopping and reading it names no
  // organization.
  getRunningTimer: {
    method: 'GET',
    path: '/api/v1/timer',
    scope: 'user',
    input: undefined,
    output: v.nullable(RunningTimer),
  },
  startTimer: {
    method: 'POST',
    path: '/api/v1/organizations/:organizationId/timer/start',
    scope: 'organization',
    input: StartTimerInput,
    output: v.object({ started: Entry, stopped: v.nullable(Entry) }),
  },
  stopTimer: {
    method: 'POST',
    path: '/api/v1/timer/stop',
    scope: 'user',
    input: StopTimerInput,
    output: Entry,
  },
  listEntries: {
    method: 'GET',
    path: entriesPath,
    scope: 'organization',
    input: ListEntriesInput,
    output: v.array(Entry),
  },
  getFirstEntryStart: {
    method: 'GET',
    path: `${entriesPath}/first-start`,
    scope: 'organization',
    input: GetFirstEntryStartInput,
    output: v.nullable(Timestamp),
  },
  createEntry: {
    method: 'POST',
    path: entriesPath,
    scope: 'organization',
    input: CreateEntryInput,
    output: Entry,
  },
  updateEntry: {
    method: 'PATCH',
    path: `${entriesPath}/:id`,
    scope: 'organization',
    input: UpdateEntryInput,
    output: Entry,
  },
  deleteEntry: {
    method: 'DELETE',
    path: `${entriesPath}/:id`,
    scope: 'organization',
    input: DeleteEntryInput,
    output: v.object({ id: v.string() }),
  },
} satisfies Record<string, Operation>

type Operations = typeof operations
export type OperationName = keyof Operations

type OwnInput<Schema> = Schema extends v.GenericSchema ? v.InferInput<Schema> : void

// What a caller passes: the call's own input, plus the organization it acts in.
export type InputOf<K extends OperationName> = Operations[K]['scope'] extends 'organization'
  ? OwnInput<Operations[K]['input']> & { organizationId: string }
  : OwnInput<Operations[K]['input']>

// The call's input once validated, as the rules take it.
export type ParsedInputOf<K extends OperationName> = Operations[K]['input'] extends v.GenericSchema
  ? v.InferOutput<Operations[K]['input']>
  : undefined

export type OutputOf<K extends OperationName> = v.InferOutput<Operations[K]['output']>
