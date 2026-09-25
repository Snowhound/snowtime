import * as v from 'valibot'
import { m } from '~/paraglide/messages.js'
import { Description, Timestamp, Uuidv7 } from '../schemas'

// The longest an entry runs. Stopping a timer ends it here at the latest, so the queries of
// a range can start reading entries this long before it, on the started_at index, instead of
// from the user's first entry.
export const MAX_ENTRY_HOURS = 24
export const MAX_ENTRY_MS = MAX_ENTRY_HOURS * 3_600_000

// A manual, finished entry. Admins and owners may log one for another member (userId).
export const CreateEntryInput = v.pipe(
  v.object({
    id: Uuidv7,
    userId: v.optional(Uuidv7),
    projectId: v.nullish(Uuidv7),
    description: v.optional(Description, ''),
    startedAt: Timestamp,
    stoppedAt: Timestamp,
  }),
  // Reported on stoppedAt, so a form shows it under the end field.
  v.forward(
    v.partialCheck(
      [['startedAt'], ['stoppedAt']],
      (i) => i.stoppedAt > i.startedAt,
      () => m.validation_end_before_start(),
    ),
    ['stoppedAt'],
  ),
  v.forward(
    v.partialCheck(
      [['startedAt'], ['stoppedAt']],
      (i) => i.stoppedAt.getTime() - i.startedAt.getTime() <= MAX_ENTRY_MS,
      () => m.validation_entry_too_long({ hours: MAX_ENTRY_HOURS }),
    ),
    ['stoppedAt'],
  ),
)
export type CreateEntryInput = v.InferOutput<typeof CreateEntryInput>

// Only the fields present change. projectId null removes the project.
export const UpdateEntryInput = v.object({
  id: Uuidv7,
  projectId: v.nullish(Uuidv7),
  description: v.optional(Description),
  startedAt: v.optional(Timestamp),
  stoppedAt: v.optional(Timestamp),
})
export type UpdateEntryInput = v.InferOutput<typeof UpdateEntryInput>

export const DeleteEntryInput = v.object({ id: Uuidv7 })
export type DeleteEntryInput = v.InferOutput<typeof DeleteEntryInput>

// Longest range listEntries returns, to keep one call's reads bounded.
export const MAX_LIST_DAYS = 93

// Entries overlapping [from, to), optionally of one user.
export const ListEntriesInput = v.pipe(
  v.object({ from: Timestamp, to: Timestamp, userId: v.optional(Uuidv7) }),
  v.check(
    (i) => i.to > i.from,
    () => m.validation_range_end_before_start(),
  ),
  v.check(
    (i) => i.to.getTime() - i.from.getTime() <= MAX_LIST_DAYS * 86_400_000,
    () => m.validation_range_too_long({ days: MAX_LIST_DAYS }),
  ),
)
export type ListEntriesInput = v.InferOutput<typeof ListEntriesInput>

// The start of one user's earliest entry, for telling the timer whether earlier time exists.
export const GetFirstEntryStartInput = v.object({ userId: Uuidv7 })
export type GetFirstEntryStartInput = v.InferOutput<typeof GetFirstEntryStartInput>
