// The timer view's queries and its optimistic mutations. The running timer and the entry
// lists are separate caches, since the running timer spans organizations; each mutation
// updates both before the server answers and rolls both back on error.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import type { Range } from '~/lib/calendar'
import { cacheUpdate, optimistic } from '~/lib/query'
import { sessionQuery } from '~/lib/session'
import {
  createEntry,
  deleteEntry,
  getFirstEntryStart,
  listEntries,
  updateEntry,
} from '~/server/entries/entries.functions'
import type {
  CreateEntryInput,
  DeleteEntryInput,
  UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import { getRunningTimer, startTimer, stopTimer } from '~/server/timer/timer.functions'
import type { StartTimerInput, StopTimerInput } from '~/server/timer/timer.schemas'

type ListedEntry = Awaited<ReturnType<typeof listEntries>>[number]

// The fields the view reads, so an optimistic entry needs no audit columns.
export type Entry = Pick<
  ListedEntry,
  'id' | 'organizationId' | 'userId' | 'projectId' | 'description' | 'startedAt' | 'stoppedAt'
>

// The running entry, with its project for a timer running in another organization, whose
// projects the view hasn't loaded.
export type RunningTimer = Entry & {
  project: { id: string; name: string; color: string | null } | null
}

export const runningTimerQuery = queryOptions({
  queryKey: ['timer'],
  queryFn: (): Promise<RunningTimer | null> => getRunningTimer(),
})

// The user's own entries overlapping the range, newest first, a running one included.
export function entriesQuery(organizationId: string, userId: string, range: Range) {
  return queryOptions({
    queryKey: ['entries', organizationId, userId, range.from, range.to],
    queryFn: (): Promise<Entry[]> =>
      listEntries({ data: { from: new Date(range.from), to: new Date(range.to), userId } }),
  })
}

// When the user's earliest entry started, so the view knows whether earlier time exists.
// Its key is outside ['entries'], whose caches hold entry lists.
export function firstEntryQuery(organizationId: string, userId: string) {
  return queryOptions({
    queryKey: ['first-entry', organizationId, userId],
    queryFn: () => getFirstEntryStart({ data: { userId } }),
  })
}

const entriesKey = ['entries']
const firstEntryKey = ['first-entry']

// An entry now starting at `startedAt` may be the earliest.
function earliest(first: Date | null, startedAt: Date | undefined) {
  return startedAt && (!first || startedAt < first) ? startedAt : first
}

// The changed fields of an update; projectId null removes the project.
function patch<T extends Entry>(entry: T, input: UpdateEntryInput): T {
  return {
    ...entry,
    projectId: input.projectId === undefined ? entry.projectId : input.projectId,
    description: input.description ?? entry.description,
    startedAt: input.startedAt ?? entry.startedAt,
    stoppedAt: input.stoppedAt ?? entry.stoppedAt,
  }
}

// Starting stops a running timer first, in any organization.
export function useStartTimer() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: StartTimerInput) => startTimer({ data: input }),
    ...optimistic(queryClient, [
      cacheUpdate<Entry[], StartTimerInput>(entriesKey, (entries) => {
        const now = new Date()
        return entries.map((e) => (e.stoppedAt ? e : { ...e, stoppedAt: now }))
      }),
      cacheUpdate<RunningTimer | null, StartTimerInput>(runningTimerQuery.queryKey, (_, input) => {
        const session = queryClient.getQueryData(sessionQuery.queryKey)
        return {
          id: input.id,
          organizationId: session?.activeOrganizationId ?? '',
          userId: session?.user.id ?? '',
          projectId: input.projectId ?? null,
          description: input.description.trim(),
          startedAt: new Date(),
          stoppedAt: null,
          project: null,
        }
      }),
    ]),
  }))
}

export function useStopTimer() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: StopTimerInput) => stopTimer({ data: input }),
    ...optimistic(queryClient, [
      cacheUpdate<Entry[], StopTimerInput>(entriesKey, (entries, { id }) => {
        const now = new Date()
        return entries.map((e) => (e.id === id ? { ...e, stoppedAt: now } : e))
      }),
      cacheUpdate<RunningTimer | null, StopTimerInput>(
        runningTimerQuery.queryKey,
        (running, { id }) => (running?.id === id ? null : running),
      ),
    ]),
  }))
}

// Edits a stopped entry, or the running one.
export function useUpdateEntry() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: UpdateEntryInput) => updateEntry({ data: input }),
    ...optimistic(queryClient, [
      cacheUpdate<Entry[], UpdateEntryInput>(entriesKey, (entries, input) =>
        entries.map((e) => (e.id === input.id ? patch(e, input) : e)),
      ),
      cacheUpdate<Date | null, UpdateEntryInput>(firstEntryKey, (first, input) =>
        earliest(first, input.startedAt),
      ),
      cacheUpdate<RunningTimer | null, UpdateEntryInput>(
        runningTimerQuery.queryKey,
        (running, input) => {
          if (running?.id !== input.id) return running
          const projectChanged =
            input.projectId !== undefined && input.projectId !== running.projectId
          return { ...patch(running, input), project: projectChanged ? null : running.project }
        },
      ),
    ]),
  }))
}

export function useDeleteEntry() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: DeleteEntryInput) => deleteEntry({ data: input }),
    ...optimistic(queryClient, [
      cacheUpdate<Entry[], DeleteEntryInput>(entriesKey, (entries, { id }) =>
        entries.filter((e) => e.id !== id),
      ),
      // Unchanged until the refetch, which the update causes, finds the new earliest.
      cacheUpdate<Date | null, DeleteEntryInput>(firstEntryKey, (first) => first),
    ]),
  }))
}

// A finished entry logged by hand.
export function useCreateEntry() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: CreateEntryInput) => createEntry({ data: input }),
    ...optimistic(queryClient, [
      cacheUpdate<Entry[], CreateEntryInput>(entriesKey, (entries, input) => {
        const session = queryClient.getQueryData(sessionQuery.queryKey)
        const entry: Entry = {
          id: input.id,
          organizationId: session?.activeOrganizationId ?? '',
          userId: session?.user.id ?? '',
          projectId: input.projectId ?? null,
          description: input.description.trim(),
          startedAt: input.startedAt,
          stoppedAt: input.stoppedAt,
        }
        return [entry, ...entries].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      }),
      cacheUpdate<Date | null, CreateEntryInput>(firstEntryKey, (first, input) =>
        earliest(first, input.startedAt),
      ),
    ]),
  }))
}
