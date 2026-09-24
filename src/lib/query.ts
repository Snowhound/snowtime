import type { QueryClient, QueryKey } from '@tanstack/solid-query'
import { v7 as uuidv7 } from 'uuid'

// Ids for app-owned rows, generated on the client so an optimistic row keeps its key once
// the server confirms it (docs/architecture.md, "Data conventions").
export const newId = () => uuidv7()

// Callbacks for a mutation that updates cached data before the server answers. `update`
// runs on every cached query under `queryKey` (for example each loaded range of entries).
// On error the cache goes back to its snapshot; either way the queries refetch after.
//
//   useMutation(() => ({
//     mutationFn: (entry) => deleteEntry({ data: entry }),
//     ...optimistic(queryClient, {
//       queryKey: ['entries'],
//       update: (entries: Entry[], vars) => entries.filter((e) => e.id !== vars.id),
//     }),
//   }))
export function optimistic<TData, TVariables>(
  queryClient: QueryClient,
  options: { queryKey: QueryKey; update: (data: TData, variables: TVariables) => TData },
) {
  const { queryKey, update } = options
  return {
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey })
      const snapshot = queryClient.getQueriesData<TData>({ queryKey })
      queryClient.setQueriesData<TData>({ queryKey }, (data) =>
        data === undefined ? data : update(data, variables),
      )
      return { snapshot }
    },
    onError: (
      _error: unknown,
      _variables: TVariables,
      context: { snapshot: [QueryKey, TData | undefined][] } | undefined,
    ) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  }
}
