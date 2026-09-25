// Time entries in the scope's organization. Everyone writes their own entries; admins and
// owners also write other members' entries; team leads only read their teams' entries
// (docs/architecture.md, "Tenancy").
import { and, count, desc, eq, gt, inArray, isNull, lt, min, ne, or } from 'drizzle-orm'
import type { Database, Executor } from '~/db'
import { member, timeEntry } from '~/db/schema'
import { AppError } from '../errors'
import { limits } from '../limits.server'
import { assertUsableProject } from '../projects/projects.server'
import { failedConstraint, live } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
import { MAX_ENTRY_MS } from './entries.schemas'
import type {
  CreateEntryInput,
  GetFirstEntryStartInput,
  DeleteEntryInput,
  ListEntriesInput,
  UpdateEntryInput,
} from './entries.schemas'

function assertCanWrite(scope: Scope, userId: string) {
  if (userId !== scope.userId && !isAdmin(scope)) {
    throw new AppError('FORBIDDEN', 'entry_forbidden')
  }
}

async function findEntry(db: Database, scope: Scope, id: string) {
  const [entry] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.id, id), live(timeEntry, scope)))
  if (!entry) throw new AppError('NOT_FOUND', 'entry_not_found')
  return entry
}

const day = 24 * 60 * 60 * 1000

// Refuses a new entry when the user already has limits.entriesPerMemberPerDay entries in
// the organization starting within a day of it. Moving an entry checks the same, without
// counting the entry itself. The (organization_id, user_id, started_at) index makes this
// one short range read.
export async function assertEntryRoom(
  db: Executor,
  organizationId: string,
  userId: string,
  startedAt: Date,
  movingId?: string,
) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(timeEntry)
    .where(
      and(
        live(timeEntry, { organizationId }),
        eq(timeEntry.userId, userId),
        gt(timeEntry.startedAt, new Date(startedAt.getTime() - day)),
        lt(timeEntry.startedAt, new Date(startedAt.getTime() + day)),
        movingId ? ne(timeEntry.id, movingId) : undefined,
      ),
    )
  if (total >= limits.entriesPerMemberPerDay) {
    throw new AppError('LIMIT_REACHED', 'entry_limit')
  }
}

export async function createEntry(db: Database, scope: Scope, input: CreateEntryInput) {
  const userId = input.userId ?? scope.userId
  assertCanWrite(scope, userId)
  if (userId !== scope.userId) {
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, scope.organizationId), eq(member.userId, userId)))
    if (!membership) throw new AppError('NOT_FOUND', 'member_not_found')
  }
  if (input.projectId) await assertUsableProject(db, scope, input.projectId)
  await assertEntryRoom(db, scope.organizationId, userId, input.startedAt)

  try {
    const [entry] = await db
      .insert(timeEntry)
      .values({
        id: input.id,
        organizationId: scope.organizationId,
        userId,
        projectId: input.projectId ?? null,
        description: input.description,
        startedAt: input.startedAt,
        stoppedAt: input.stoppedAt,
      })
      .returning()
    return entry
  } catch (error) {
    if (failedConstraint(error) === 'time_entry.id') {
      throw new AppError('CONFLICT', 'entry_id_taken')
    }
    throw error
  }
}

// Updates the fields present in input. A running entry keeps running: stop it with
// stopTimer, not by setting stoppedAt here.
export async function updateEntry(db: Database, scope: Scope, input: UpdateEntryInput) {
  const entry = await findEntry(db, scope, input.id)
  assertCanWrite(scope, entry.userId)

  if (input.stoppedAt && !entry.stoppedAt) {
    throw new AppError('INVALID', 'entry_running')
  }
  const startedAt = input.startedAt ?? entry.startedAt
  const stoppedAt = input.stoppedAt ?? entry.stoppedAt
  if (stoppedAt && stoppedAt <= startedAt) {
    throw new AppError('INVALID', 'entry_end_before_start')
  }
  if (stoppedAt && stoppedAt.getTime() - startedAt.getTime() > MAX_ENTRY_MS) {
    throw new AppError('INVALID', 'entry_too_long')
  }
  // Keeping an archived project is fine; moving time onto one is not.
  if (input.projectId && input.projectId !== entry.projectId) {
    await assertUsableProject(db, scope, input.projectId)
  }
  if (input.startedAt && input.startedAt.getTime() !== entry.startedAt.getTime()) {
    await assertEntryRoom(db, scope.organizationId, entry.userId, input.startedAt, entry.id)
  }

  // The checks above read the entry before the update, so a concurrent edit of the other
  // end can still make it too long or end before it starts. The database refuses both
  // (time_entry_stopped_after_started, time_entry_max_length).
  try {
    const [updated] = await db
      .update(timeEntry)
      .set({
        projectId: input.projectId,
        description: input.description,
        startedAt: input.startedAt,
        stoppedAt: input.stoppedAt,
      })
      .where(and(eq(timeEntry.id, entry.id), live(timeEntry, scope)))
      .returning()
    if (!updated) throw new AppError('NOT_FOUND', 'entry_not_found')
    return updated
  } catch (error) {
    if (failedConstraint(error) === 'time_entry_stopped_after_started') {
      throw new AppError('INVALID', 'entry_end_before_start')
    }
    if (failedConstraint(error) === 'time_entry_max_length') {
      throw new AppError('INVALID', 'entry_too_long')
    }
    throw error
  }
}

// Logical delete: the row stays, with sys_deleted set and updated_by recording who.
export async function deleteEntry(db: Database, scope: Scope, input: DeleteEntryInput) {
  const entry = await findEntry(db, scope, input.id)
  assertCanWrite(scope, entry.userId)
  await db
    .update(timeEntry)
    .set({ sysDeleted: true })
    .where(and(eq(timeEntry.id, entry.id), live(timeEntry, scope)))
  return { id: entry.id }
}

// Entries overlapping [from, to), newest first, including a running one. Members see their
// own; team leads also their teams' members'; admins and owners everyone's.
async function assertReadable(db: Database, scope: Scope, userId: string) {
  const readable = await readableUserIds(db, scope)
  if (readable && !readable.includes(userId)) {
    throw new AppError('FORBIDDEN', 'entries_forbidden')
  }
}

// When the user's earliest entry in the organization started, or null without entries.
export async function getFirstEntryStart(
  db: Database,
  scope: Scope,
  input: GetFirstEntryStartInput,
) {
  await assertReadable(db, scope, input.userId)
  const [row] = await db
    .select({ startedAt: min(timeEntry.startedAt) })
    .from(timeEntry)
    .where(and(live(timeEntry, scope), eq(timeEntry.userId, input.userId)))
  return row?.startedAt ?? null
}

export async function listEntries(db: Database, scope: Scope, input: ListEntriesInput) {
  const readable = await readableUserIds(db, scope)
  if (input.userId && readable && !readable.includes(input.userId)) {
    throw new AppError('FORBIDDEN', 'entries_forbidden')
  }
  const users = input.userId ? [input.userId] : readable

  return db
    .select()
    .from(timeEntry)
    .where(
      and(
        live(timeEntry, scope),
        users ? inArray(timeEntry.userId, users) : undefined,
        gt(timeEntry.startedAt, new Date(input.from.getTime() - MAX_ENTRY_MS)),
        lt(timeEntry.startedAt, input.to),
        or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, input.from)),
      ),
    )
    .orderBy(desc(timeEntry.startedAt))
}
