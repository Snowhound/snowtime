import * as v from 'valibot'
import { Description, Timestamp, Uuidv7 } from './common'

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
      'The end must be after the start.',
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
  v.check((i) => i.to > i.from, 'The range must end after it starts.'),
  v.check(
    (i) => i.to.getTime() - i.from.getTime() <= MAX_LIST_DAYS * 86_400_000,
    `The range can span at most ${MAX_LIST_DAYS} days.`,
  ),
)
export type ListEntriesInput = v.InferOutput<typeof ListEntriesInput>
