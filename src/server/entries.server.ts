// Time entries in the scope's organization. Everyone writes their own entries; admins and
// owners also write other members' entries; team leads only read their teams' entries
// (docs/architecture.md, "Tenancy").
import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '../db'
import { member, timeEntry } from '../db/schema'
import type {
  CreateEntryInput,
  DeleteEntryInput,
  ListEntriesInput,
  UpdateEntryInput,
} from '../schemas/entries'
import { AppError } from './errors'
import { assertUsableProject } from './projects.server'
import { failedConstraint, live } from './queries.server'
import { isAdmin, readableUserIds, type Scope } from './scope.server'

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
  // Keeping an archived project is fine; moving time onto one is not.
  if (input.projectId && input.projectId !== entry.projectId) {
    await assertUsableProject(db, scope, input.projectId)
  }

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
        lt(timeEntry.startedAt, input.to),
        or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, input.from)),
      ),
    )
    .orderBy(desc(timeEntry.startedAt))
}
