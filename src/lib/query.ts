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
//
// With `delay`, the update waits that many milliseconds for the server: a success applies
// it at once, an error leaves the caches as they were, and without an answer by then it
// applies anyway. For writes the server often refuses, such as deleting a project with
// time, so a refusal doesn't make the item vanish and come back.
export function optimistic<TData, TVariables>(
  queryClient: QueryClient,
  options:
    | { queryKey: QueryKey; update: (data: TData, variables: TVariables) => TData }
    | CacheUpdate<TVariables>[],
  { delay = 0 }: { delay?: number } = {},
) {
  const updates = Array.isArray(options)
    ? options
    : [cacheUpdate<TData, TVariables>(options.queryKey, options.update)]
  type Context = {
    snapshot: [QueryKey, unknown][]
    applied: boolean
    timer?: ReturnType<typeof setTimeout>
  }

  function apply(variables: TVariables) {
    for (const { queryKey, update } of updates) {
      queryClient.setQueriesData({ queryKey }, (data: unknown) =>
        data === undefined ? data : update(data, variables),
      )
    }
  }

  return {
    onMutate: async (variables: TVariables): Promise<Context> => {
      await Promise.all(updates.map(({ queryKey }) => queryClient.cancelQueries({ queryKey })))
      const snapshot = updates.flatMap(({ queryKey }) => queryClient.getQueriesData({ queryKey }))
      const context: Context = { snapshot, applied: delay <= 0 }
      if (context.applied) apply(variables)
      else {
        context.timer = setTimeout(() => {
          context.applied = true
          apply(variables)
        }, delay)
      }
      return context
    },
    onSuccess: (_data: unknown, variables: TVariables, context: Context | undefined) => {
      if (!context || context.applied) return
      clearTimeout(context.timer)
      context.applied = true
      apply(variables)
    },
    onError: (_error: unknown, _variables: TVariables, context: Context | undefined) => {
      clearTimeout(context?.timer)
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () =>
      Promise.all(updates.map(({ queryKey }) => queryClient.invalidateQueries({ queryKey }))).then(
        () => undefined,
      ),
  }
}
