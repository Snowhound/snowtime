import type { QueryClient, QueryKey } from '@tanstack/solid-query'
import { v7 as uuidv7 } from 'uuid'
import {
  finishChange,
  isRefused,
  pendingContext,
  retainChange,
  waitingError,
  waitsBehind,
} from './refusal'

// How long the organization's projects, teams and members stay fresh. This app's own changes
// update their caches at once, so the wait only delays other people's changes. Each refetch is a
// server call with its database reads, and a tab regaining focus refetches every stale query.
export const ORGANIZATION_STALE_TIME = 5 * 60_000

// Ids for app-owned rows, generated on the client so an optimistic row keeps its key once
// the server confirms it (docs/architecture/data.md, "Data conventions").
export function newId() {
  return uuidv7()
}

// Reports and the Projects view's month totals live under this key. A write that changes
// logged time or who counts in a team marks them stale (`invalidate` below): their views
// are usually closed while it happens, and would open on the old totals.
export const reportsKey = ['report']

// One cache a mutation updates before the server answers. `update` runs on every cached
// query under `queryKey` (for example each loaded range of entries) and gets that query's
// full key, so it can leave out the ones the change doesn't belong in.
export interface CacheUpdate<TVariables> {
  queryKey: QueryKey
  update: (data: unknown, variables: TVariables, queryKey: QueryKey, now: number) => unknown
}

export function cacheUpdate<TData, TVariables>(
  queryKey: QueryKey,
  update: (data: TData, variables: TVariables, queryKey: QueryKey, now: number) => TData,
): CacheUpdate<TVariables> {
  return {
    queryKey,
    update: (data, variables, key, now) => update(data as TData, variables, key, now),
  }
}

// Callbacks for a mutation that updates each cache in `updates` before the server answers.
// A refused write keeps its optimistic change until the user sends it again (refusal.ts),
// and a write made meanwhile waits behind it. Other failures restore the snapshot, and
// completed writes invalidate their queries.
//
// `invalidate` lists more keys to refetch after, for caches the write changes but that
// can't be updated here, such as reports.
export function optimistic<TVariables>(
  queryClient: QueryClient,
  updates: CacheUpdate<TVariables>[],
  { invalidate = [] }: { invalidate?: QueryKey[] } = {},
) {
  type Context = { snapshot: [QueryKey, unknown][]; now: number }

  function keep(variables: TVariables, context: Context, error: unknown) {
    // A refetch replaces the cache with the server's data, which lacks the pending change:
    // it becomes the rollback point, and the change goes back on top.
    retainChange(queryClient, variables, context, error, (key, data) => {
      const matched = updates.filter(({ queryKey }) =>
        queryClient
          .getQueryCache()
          .findAll({ queryKey })
          .some((query) => query.queryKey === key),
      )
      if (!matched.length) return
      const snapshot = context.snapshot.find(
        ([snapshotKey]) => JSON.stringify(snapshotKey) === JSON.stringify(key),
      )
      if (snapshot) snapshot[1] = data
      else context.snapshot.push([key, data])
      for (const { update } of matched) {
        queryClient.setQueryData(key, (current: unknown) =>
          update(current, variables, key, context.now),
        )
      }
    })
  }

  return {
    retry: false as const,
    onMutate: async (variables: TVariables): Promise<Context> => {
      await Promise.all(updates.map(({ queryKey }) => queryClient.cancelQueries({ queryKey })))
      let context = pendingContext(queryClient, variables) as Context | undefined
      if (!context) {
        const now = Date.now()
        const snapshot = updates.flatMap(({ queryKey }) => queryClient.getQueriesData({ queryKey }))
        for (const { queryKey, update } of updates) {
          for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
            if (data !== undefined) queryClient.setQueryData(key, update(data, variables, key, now))
          }
        }
        context = { snapshot, now }
      }
      if (waitsBehind(queryClient, variables)) {
        const error = waitingError()
        keep(variables, context, error)
        throw error
      }
      return context
    },
    onError: (error: unknown, variables: TVariables, mutated: Context | undefined) => {
      const context = mutated ?? (pendingContext(queryClient, variables) as Context | undefined)
      if (context && isRefused(error)) {
        keep(variables, context, error)
        return
      }
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: (_data: unknown, error: unknown, variables: TVariables) => {
      if (isRefused(error)) return Promise.resolve()
      finishChange(queryClient, variables)
      return Promise.all(
        [...updates.map(({ queryKey }) => queryKey), ...invalidate].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ).then(() => undefined)
    },
  }
}
