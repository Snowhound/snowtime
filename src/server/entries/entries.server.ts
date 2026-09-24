// Time entries in the scope's organization. Everyone writes their own entries; admins and
// owners also write other members' entries; team leads only read their teams' entries
// (docs/architecture.md, "Tenancy").
import { and, desc, eq, gt, inArray, isNull, lt, min, or } from 'drizzle-orm'
import type { Database } from '~/db'
import { member, timeEntry } from '~/db/schema'
import { AppError } from '../errors'
import { assertUsableProject } from '../projects/projects.server'
import { failedConstraint, live } from '../queries.server'
import { isAdmin, readableUserIds, type Scope } from '../scope.server'
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
        lt(timeEntry.startedAt, input.to),
        or(isNull(timeEntry.stoppedAt), gt(timeEntry.stoppedAt, input.from)),
      ),
    )
    .orderBy(desc(timeEntry.startedAt))
}
