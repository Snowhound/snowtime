// The TypeScript app's transport: Start's server functions, which run in process during
// Start's server render and over Start's own protocol from the browser. Typing each one
// against the contract checks the rules' return types against the output schemas.
import {
  createEntry,
  deleteEntry,
  getFirstEntryStart,
  listEntries,
  updateEntry,
} from '~/server/entries/entries.functions'
import { getRunningTimer, startTimer, stopTimer } from '~/server/timer/timer.functions'
import type { Transport } from './client'
import type { InputOf, OperationName, OutputOf } from './operations'

const functions: { [K in OperationName]: (input: InputOf<K>) => Promise<OutputOf<K>> } = {
  getRunningTimer: () => getRunningTimer(),
  startTimer: (data) => startTimer({ data }),
  stopTimer: (data) => stopTimer({ data }),
  listEntries: (data) => listEntries({ data }),
  getFirstEntryStart: (data) => getFirstEntryStart({ data }),
  createEntry: (data) => createEntry({ data }),
  updateEntry: (data) => updateEntry({ data }),
  deleteEntry: (data) => deleteEntry({ data }),
}

export const serverFunctions: Transport = (name, input) =>
  (functions[name] as (input: unknown) => Promise<OutputOf<typeof name>>)(input)
