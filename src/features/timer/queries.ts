// The timer view's queries and its optimistic mutations. The running timer and the entry
// lists are separate caches, since the running timer spans organizations; each mutation
// updates both before the server answers and rolls both back on error.
import { type QueryKey, queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import type { Range } from '~/lib/calendar'
import { cacheUpdate, optimistic, reportsKey } from '~/lib/queries/query'
import { sessionQuery } from '~/lib/queries/session'
import {
  createEntry,
  deleteEntry,
  getFirstEntryStart,
  listEntries,
  updateEntry,
} from '~/server/entries/entries.functions'
import {
  type CreateEntryInput,
  type DeleteEntryInput,
  MAX_ENTRY_MS,
  type UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import { getRunningTimer, startTimer, stopTimer } from '~/server/timer/timer.functions'
import type { StartTimerInput, StopTimerInput } from '~/server/timer/timer.schemas'

type ListedEntry = Awaited<ReturnType<typeof listEntries>>[number]

// The fields the view reads, so an optimistic entry needs no audit columns.
export type Entry = Pick<
  ListedEntry,
  | 'id'
  | 'organizationId'
  | 'userId'
  | 'projectId'
  | 'description'
  | 'ticket'
  | 'startedAt'
  | 'stoppedAt'
>

// An entry that has ended, as the day lists show and edit them.
export type StoppedEntry = Entry & { stoppedAt: Date }

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
      listEntries({
        data: { organizationId, from: new Date(range.from), to: new Date(range.to), userId },
      }),
  })
}

// When the user's earliest entry started, so the view knows whether earlier time exists.
// Its key is outside ['entries'], whose caches hold entry lists.
export function firstEntryQuery(organizationId: string, userId: string) {
  return queryOptions({
    queryKey: ['first-entry', organizationId, userId],
    queryFn: () => getFirstEntryStart({ data: { organizationId, userId } }),
  })
}

// The organization's entry lists and earliest start. The running timer spans organizations.
function entriesKey(organizationId: string) {
  return ['entries', organizationId]
}
function firstEntryKey(organizationId: string) {
  return ['first-entry', organizationId]
}

// Every write changes logged time, which Reports and the Projects view total, and the
// session's fill summary for the tagline.
const settled = { invalidate: [reportsKey, sessionQuery.queryKey] }

// Whether an entry belongs in the list cached under `key`: the list's organization and user,
// and a range it overlaps, as listEntries reads them.
function listed(entry: Entry, key: QueryKey) {
  const [, organizationId, userId, from, to] = key as [string, string, string, number, number]
  return (
    entry.organizationId === organizationId &&
    entry.userId === userId &&
    entry.startedAt.getTime() < to &&
    (!entry.stoppedAt || entry.stoppedAt.getTime() > from)
  )
}

function newestFirst(entries: Entry[]) {
  return entries.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
}

// Where the server stops a timer now: at most MAX_ENTRY_HOURS after its start (stopAt in
// timer.server.ts).
function stoppedNow(entry: Entry) {
  return new Date(Math.min(Date.now(), entry.startedAt.getTime() + MAX_ENTRY_MS))
}

// An entry now starting at `startedAt` may be the earliest.
function earliest(first: Date | null, startedAt: Date | undefined) {
  return startedAt && (!first || startedAt < first) ? startedAt : first
}

// The changed fields of an update; projectId or ticket null removes it.
function patch<T extends Entry>(entry: T, input: UpdateEntryInput): T {
  return {
    ...entry,
    projectId: input.projectId === undefined ? entry.projectId : input.projectId,
    description: input.description ?? entry.description,
    ticket: input.ticket === undefined ? entry.ticket : input.ticket,
    startedAt: input.startedAt ?? entry.startedAt,
    stoppedAt: input.stoppedAt ?? entry.stoppedAt,
  }
}

// The organization the view shows, which the writes below act in.
type Keys = { organizationId: string }

// Starting stops a running timer first, in any organization.
export function useStartTimer({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: StartTimerInput) => startTimer({ data: { ...input, organizationId } }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], StartTimerInput>(['entries'], (entries) =>
          entries.map((e) => (e.stoppedAt ? e : { ...e, stoppedAt: stoppedNow(e) })),
        ),
        cacheUpdate<RunningTimer | null, StartTimerInput>(
          runningTimerQuery.queryKey,
          (_, input) => {
            const session = queryClient.getQueryData(sessionQuery.queryKey)
            return {
              id: input.id,
              organizationId,
              userId: session?.user.id ?? '',
              projectId: input.projectId ?? null,
              description: input.description.trim(),
              ticket: input.ticket ?? null,
              startedAt: new Date(),
              stoppedAt: null,
              project: null,
            }
          },
        ),
      ],
      settled,
    ),
  }))
}

export function useStopTimer() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: StopTimerInput) => stopTimer({ data: input }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], StopTimerInput>(['entries'], (entries, { id }) =>
          entries.map((e) => (e.id === id ? { ...e, stoppedAt: stoppedNow(e) } : e)),
        ),
        cacheUpdate<RunningTimer | null, StopTimerInput>(
          runningTimerQuery.queryKey,
          (running, { id }) => (running?.id === id ? null : running),
        ),
      ],
      settled,
    ),
  }))
}

// Edits a stopped entry, or the running one.
export function useUpdateEntry({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: UpdateEntryInput) => updateEntry({ data: { ...input, organizationId } }),
    ...optimistic(
      queryClient,
      [
        // An entry moved out of a range leaves its list, and one moved into a range joins
        // it, so the calendar's week shows an entry moved there at once.
        cacheUpdate<Entry[], UpdateEntryInput>(
          entriesKey(organizationId),
          (entries, input, key) => {
            const entry =
              entries.find((e) => e.id === input.id) ??
              queryClient
                .getQueriesData<Entry[]>({ queryKey: entriesKey(organizationId) })
                .flatMap(([, data]) => data ?? [])
                .find((e) => e.id === input.id)
            if (!entry) return entries
            const updated = patch(entry, input)
            const rest = entries.filter((e) => e.id !== input.id)
            return listed(updated, key) ? newestFirst([updated, ...rest]) : rest
          },
        ),
        cacheUpdate<Date | null, UpdateEntryInput>(firstEntryKey(organizationId), (first, input) =>
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
      ],
      settled,
    ),
  }))
}

export function useDeleteEntry({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: DeleteEntryInput) => deleteEntry({ data: { ...input, organizationId } }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], DeleteEntryInput>(entriesKey(organizationId), (entries, { id }) =>
          entries.filter((e) => e.id !== id),
        ),
      ],
      // The earliest start may have been this entry's.
      { invalidate: [...settled.invalidate, firstEntryKey(organizationId)] },
    ),
  }))
}

// A finished entry logged by hand.
export function useCreateEntry({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: CreateEntryInput) => createEntry({ data: { ...input, organizationId } }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], CreateEntryInput>(
          entriesKey(organizationId),
          (entries, input, key) => {
            const session = queryClient.getQueryData(sessionQuery.queryKey)
            const entry: Entry = {
              id: input.id,
              organizationId,
              userId: session?.user.id ?? '',
              projectId: input.projectId ?? null,
              description: input.description.trim(),
              ticket: input.ticket ?? null,
              startedAt: input.startedAt,
              stoppedAt: input.stoppedAt,
            }
            if (!listed(entry, key)) return entries
            return newestFirst([entry, ...entries])
          },
        ),
        cacheUpdate<Date | null, CreateEntryInput>(firstEntryKey(organizationId), (first, input) =>
          earliest(first, input.startedAt),
        ),
      ],
      settled,
    ),
  }))
}
