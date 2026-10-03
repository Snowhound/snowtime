// The contract's calls by name (task 084). Both backends serve each one, and the client
// module reaches them through one transport.
import type * as v from 'valibot'
import { entriesOperations } from '~/server/entries/entries.schemas'
import { timerOperations } from '~/server/timer/timer.schemas'

export const operations = { ...timerOperations, ...entriesOperations }

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
