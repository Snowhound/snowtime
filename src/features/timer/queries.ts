// The timer view's queries and its optimistic mutations. The running timer and the entry
// lists are separate caches, since the running timer spans organizations; each mutation
// updates both before the server answers and keeps a refused change pending.
import {
  type QueryClient,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/solid-query'
import {
  createEntries,
  createEntry,
  deleteEntries,
  deleteEntry,
  getFirstEntryStart,
  listEntries,
  updateEntry,
} from '~/lib/api/entries'
import { startTimer, stopTimer } from '~/lib/api/timer'
import type { Range } from '~/lib/calendar'
import { cacheUpdate, optimistic, reportsKey } from '~/lib/queries/query'
import { sessionQuery } from '~/lib/queries/session'
import { runningTimerQuery } from '~/lib/queries/timer'
import {
  type CreateEntriesInput,
  type CreateEntryInput,
  type DeleteEntriesInput,
  type DeleteEntryInput,
  type Entry,
  MAX_ENTRY_MS,
  type UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import type { RunningTimer, StartTimerInput, StopTimerInput } from '~/server/timer/timer.schemas'

export type { Entry, RunningTimer }

// An entry that has ended, as the day lists show and edit them.
export type StoppedEntry = Entry & { stoppedAt: Date }

// The user's own entries overlapping the range, newest first, a running one included.
export function entriesQuery(organizationId: string, userId: string, range: Range) {
  return queryOptions({
    queryKey: ['entries', organizationId, userId, range.from, range.to],
    queryFn: () =>
      listEntries({
        organizationId,
        from: new Date(range.from),
        to: new Date(range.to),
        userId,
      }),
  })
}

// When the user's earliest entry started, so the view knows whether earlier time exists.
// Its key is outside ['entries'], whose caches hold entry lists.
export function firstEntryQuery(organizationId: string, userId: string) {
  return queryOptions({
    queryKey: ['first-entry', organizationId, userId],
    queryFn: () => getFirstEntryStart({ organizationId, userId }),
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
// and a range it overlaps, as the listEntries rule reads them.
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
function stoppedNow(entry: Entry, now: number) {
  return new Date(Math.min(now, entry.startedAt.getTime() + MAX_ENTRY_MS))
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
    mutationFn: (input: StartTimerInput) => startTimer({ ...input, organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], StartTimerInput>(['entries'], (entries, _input, _key, now) =>
          entries.map((e) => (e.stoppedAt ? e : { ...e, stoppedAt: stoppedNow(e, now) })),
        ),
        cacheUpdate<RunningTimer | null, StartTimerInput>(
          runningTimerQuery.queryKey,
          (_, input, _key, now) => {
            const session = queryClient.getQueryData(sessionQuery.queryKey)
            return {
              id: input.id,
              organizationId,
              userId: session?.user.id ?? '',
              projectId: input.projectId ?? null,
              description: input.description.trim(),
              ticket: input.ticket ?? null,
              startedAt: new Date(now),
              stoppedAt: null,
              calendarEvent: null,
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
    mutationFn: (input: StopTimerInput) => stopTimer(input),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], StopTimerInput>(['entries'], (entries, { id }, _key, now) =>
          entries.map((e) => (e.id === id ? { ...e, stoppedAt: stoppedNow(e, now) } : e)),
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
    mutationFn: (input: UpdateEntryInput) => updateEntry({ ...input, organizationId }),
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
    mutationFn: (input: DeleteEntryInput) => deleteEntry({ ...input, organizationId }),
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

// Entries deleted together, as Undo takes back the copies a createEntries made.
export function useDeleteEntries({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: DeleteEntriesInput) => deleteEntries({ ...input, organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], DeleteEntriesInput>(entriesKey(organizationId), (entries, { ids }) =>
          entries.filter((e) => !ids.includes(e.id)),
        ),
      ],
      { invalidate: [...settled.invalidate, firstEntryKey(organizationId)] },
    ),
  }))
}

// The entries a create adds to the list cached under `key`.
function created(
  queryClient: QueryClient,
  organizationId: string,
  input: CreateEntriesInput,
  key: QueryKey,
) {
  const session = queryClient.getQueryData(sessionQuery.queryKey)
  return input.entries
    .map((e): Entry => ({
      id: e.id,
      organizationId,
      userId: session?.user.id ?? '',
      projectId: (e.projectId === undefined ? input.projectId : e.projectId) ?? null,
      description: (e.description ?? input.description).trim(),
      ticket: (e.ticket === undefined ? input.ticket : e.ticket) ?? null,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
      calendarEvent: e.calendarEvent ?? null,
    }))
    .filter((entry) => listed(entry, key))
}

// A finished entry logged by hand.
export function useCreateEntry({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: CreateEntryInput) => createEntry({ ...input, organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], CreateEntryInput>(
          entriesKey(organizationId),
          (entries, { id, startedAt, stoppedAt, calendarEvent, ...work }, key) =>
            newestFirst([
              ...created(
                queryClient,
                organizationId,
                { ...work, entries: [{ id, startedAt, stoppedAt, calendarEvent }] },
                key,
              ),
              ...entries,
            ]),
        ),
        cacheUpdate<Date | null, CreateEntryInput>(firstEntryKey(organizationId), (first, input) =>
          earliest(first, input.startedAt),
        ),
      ],
      settled,
    ),
  }))
}

// Entries of the same work saved together, such as an entry and its copies.
export function useCreateEntries({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: CreateEntriesInput) => createEntries({ ...input, organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Entry[], CreateEntriesInput>(
          entriesKey(organizationId),
          (entries, input, key) =>
            newestFirst([...created(queryClient, organizationId, input, key), ...entries]),
        ),
        cacheUpdate<Date | null, CreateEntriesInput>(
          firstEntryKey(organizationId),
          (first, input) =>
            input.entries.reduce((sooner, e) => earliest(sooner, e.startedAt), first),
        ),
      ],
      settled,
    ),
  }))
}
