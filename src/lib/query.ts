import type { QueryClient, QueryKey } from '@tanstack/solid-query'
import { v7 as uuidv7 } from 'uuid'

// Ids for app-owned rows, generated on the client so an optimistic row keeps its key once
// the server confirms it (docs/architecture.md, "Data conventions").
export function newId() {
  return uuidv7()
}

// One cache a mutation updates before the server answers. `update` runs on every cached
// query under `queryKey` (for example each loaded range of entries).
export interface CacheUpdate<TVariables> {
  queryKey: QueryKey
  update: (data: unknown, variables: TVariables) => unknown
}

export function cacheUpdate<TData, TVariables>(
  queryKey: QueryKey,
  update: (data: TData, variables: TVariables) => TData,
): CacheUpdate<TVariables> {
  return { queryKey, update: (data, variables) => update(data as TData, variables) }
}

// Callbacks for a mutation that updates cached data before the server answers. On error
// every cache goes back to its snapshot; either way the queries refetch after.
//
//   useMutation(() => ({
//     mutationFn: (entry) => deleteEntry({ data: entry }),
//     ...optimistic(queryClient, {
//       queryKey: ['entries'],
//       update: (entries: Entry[], vars) => entries.filter((e) => e.id !== vars.id),
//     }),
//   }))
//
// A mutation that touches several caches passes a list of `cacheUpdate(queryKey, update)`
// instead, as starting the timer does (src/features/timer/queries.ts).
export function optimistic<TData, TVariables>(
  queryClient: QueryClient,
  options:
    | { queryKey: QueryKey; update: (data: TData, variables: TVariables) => TData }
    | CacheUpdate<TVariables>[],
) {
  const updates = Array.isArray(options)
    ? options
    : [cacheUpdate<TData, TVariables>(options.queryKey, options.update)]
  type Snapshot = [QueryKey, unknown][]
  return {
    onMutate: async (variables: TVariables) => {
      await Promise.all(updates.map(({ queryKey }) => queryClient.cancelQueries({ queryKey })))
      const snapshot: Snapshot = updates.flatMap(({ queryKey }) =>
        queryClient.getQueriesData({ queryKey }),
      )
      for (const { queryKey, update } of updates) {
        queryClient.setQueriesData({ queryKey }, (data: unknown) =>
          data === undefined ? data : update(data, variables),
        )
      }
      return { snapshot }
    },
    onError: (
      _error: unknown,
      _variables: TVariables,
      context: { snapshot: Snapshot } | undefined,
    ) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () =>
      Promise.all(updates.map(({ queryKey }) => queryClient.invalidateQueries({ queryKey }))).then(
        () => undefined,
      ),
  }
}
