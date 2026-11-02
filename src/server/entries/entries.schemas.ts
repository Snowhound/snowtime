import * as v from 'valibot'
import { Description, Ticket, Timestamp, Uuidv7, keyed } from '../schemas'

// The longest an entry runs. Stopping a timer ends it here at the latest, so the queries of
// a range can start reading entries this long before it, on the started_at index, instead of
// from the user's first entry.
export const MAX_ENTRY_HOURS = 24
export const MAX_ENTRY_MS = MAX_ENTRY_HOURS * 3_600_000

// The most entries one createEntries or deleteEntries call takes: copies to about four and
// a half months of workdays, one transaction's worth.
export const MAX_BATCH_ENTRIES = 100

// A finished entry ends after it starts, at most MAX_ENTRY_HOURS later. The checks are
// reported on stoppedAt, so a form shows them under the end field.
type Times = { startedAt: Date; stoppedAt: Date }
const times = { id: Uuidv7, startedAt: Timestamp, stoppedAt: Timestamp }
function endsAfterStart(i: Times) {
  return i.stoppedAt > i.startedAt
}
function notTooLong(i: Times) {
  return i.stoppedAt.getTime() - i.startedAt.getTime() <= MAX_ENTRY_MS
}
const tooLong = keyed('validation_entry_too_long', () => ({ hours: MAX_ENTRY_HOURS }))

// What a manual entry is about. Admins and owners may log one for another member (userId).
const work = {
  userId: v.optional(Uuidv7),
  projectId: v.nullish(Uuidv7),
  description: v.optional(Description, ''),
  ticket: v.optional(Ticket),
}

// A manual, finished entry.
export const CreateEntryInput = v.pipe(
  v.object({ ...work, ...times }),
  v.forward(
    v.partialCheck(
      [['startedAt'], ['stoppedAt']],
      endsAfterStart,
      keyed('validation_end_before_start'),
    ),
    ['stoppedAt'],
  ),
  v.forward(v.partialCheck([['startedAt'], ['stoppedAt']], notTooLong, tooLong), ['stoppedAt']),
)
export type CreateEntryInput = v.InferOutput<typeof CreateEntryInput>

const EntryTimes = v.pipe(
  v.object(times),
  v.forward(
    v.partialCheck(
      [['startedAt'], ['stoppedAt']],
      endsAfterStart,
      keyed('validation_end_before_start'),
    ),
    ['stoppedAt'],
  ),
  v.forward(v.partialCheck([['startedAt'], ['stoppedAt']], notTooLong, tooLong), ['stoppedAt']),
)

// Manual entries of the same work at several times, such as an entry and its copies, saved
// together or not at all. The client works out each one's times in the user's zone.
export const CreateEntriesInput = v.object({
  ...work,
  entries: v.pipe(
    v.array(EntryTimes),
    v.minLength(1, keyed('validation_invalid')),
    v.maxLength(
      MAX_BATCH_ENTRIES,
      keyed('validation_too_many_entries', () => ({ max: MAX_BATCH_ENTRIES })),
    ),
  ),
})
export type CreateEntriesInput = v.InferOutput<typeof CreateEntriesInput>

// Only the fields present change. projectId or ticket null removes it.
export const UpdateEntryInput = v.object({
  id: Uuidv7,
  projectId: v.nullish(Uuidv7),
  description: v.optional(Description),
  ticket: v.optional(Ticket),
  startedAt: v.optional(Timestamp),
  stoppedAt: v.optional(Timestamp),
})
export type UpdateEntryInput = v.InferOutput<typeof UpdateEntryInput>

export const DeleteEntryInput = v.object({ id: Uuidv7 })
export type DeleteEntryInput = v.InferOutput<typeof DeleteEntryInput>

// Deleted together or not at all, as Undo takes back a createEntries.
export const DeleteEntriesInput = v.object({
  ids: v.pipe(
    v.array(Uuidv7),
    v.minLength(1, keyed('validation_invalid')),
    v.maxLength(
      MAX_BATCH_ENTRIES,
      keyed('validation_too_many_entries', () => ({ max: MAX_BATCH_ENTRIES })),
    ),
  ),
})
export type DeleteEntriesInput = v.InferOutput<typeof DeleteEntriesInput>

// Longest range listEntries returns, to keep one call's reads bounded.
const MAX_LIST_DAYS = 93

// Entries overlapping [from, to), optionally of one user.
export const ListEntriesInput = v.pipe(
  v.object({ from: Timestamp, to: Timestamp, userId: v.optional(Uuidv7) }),
  v.check((i) => i.to > i.from, keyed('validation_range_end_before_start')),
  v.check(
    (i) => i.to.getTime() - i.from.getTime() <= MAX_LIST_DAYS * 86_400_000,
    keyed('validation_range_too_long', () => ({ days: MAX_LIST_DAYS })),
  ),
)
export type ListEntriesInput = v.InferOutput<typeof ListEntriesInput>

// The start of one user's earliest entry, for telling the timer whether earlier time exists.
export const GetFirstEntryStartInput = v.object({ userId: Uuidv7 })
export type GetFirstEntryStartInput = v.InferOutput<typeof GetFirstEntryStartInput>

// An entry as the contract returns it. IDs are plain strings: seeded and imported rows
// predate uuid v7.
export const Entry = v.object({
  id: v.string(),
  organizationId: v.string(),
  userId: v.string(),
  projectId: v.nullable(v.string()),
  description: v.string(),
  ticket: v.nullable(v.string()),
  startedAt: Timestamp,
  stoppedAt: v.nullable(Timestamp),
})
export type Entry = v.InferOutput<typeof Entry>
