import type { QueryClient, QueryKey } from '@tanstack/solid-query'
import { v7 as uuidv7 } from 'uuid'

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
  update: (data: unknown, variables: TVariables, queryKey: QueryKey) => unknown
}

export function cacheUpdate<TData, TVariables>(
  queryKey: QueryKey,
  update: (data: TData, variables: TVariables, queryKey: QueryKey) => TData,
): CacheUpdate<TVariables> {
  return { queryKey, update: (data, variables, key) => update(data as TData, variables, key) }
}

// Callbacks for a mutation that updates each cache in `updates` before the server answers.
// On error every cache goes back to its snapshot; either way the queries refetch after.
//
// `invalidate` lists more keys to refetch after, for caches the write changes but that
// can't be updated here, such as reports.
export function optimistic<TVariables>(
  queryClient: QueryClient,
  updates: CacheUpdate<TVariables>[],
  { invalidate = [] }: { invalidate?: QueryKey[] } = {},
) {
  type Context = { snapshot: [QueryKey, unknown][] }

  return {
    onMutate: async (variables: TVariables): Promise<Context> => {
      await Promise.all(updates.map(({ queryKey }) => queryClient.cancelQueries({ queryKey })))
      const snapshot = updates.flatMap(({ queryKey }) => queryClient.getQueriesData({ queryKey }))
      for (const { queryKey, update } of updates) {
        for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
          if (data !== undefined) queryClient.setQueryData(key, update(data, variables, key))
        }
      }
      return { snapshot }
    },
    onError: (_error: unknown, _variables: TVariables, context: Context | undefined) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () =>
      Promise.all(
        [...updates.map(({ queryKey }) => queryKey), ...invalidate].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ).then(() => undefined),
  }
}
