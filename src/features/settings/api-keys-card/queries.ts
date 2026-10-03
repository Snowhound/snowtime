// The API keys card's query and mutations. Creating isn't optimistic: the list can only show
// a key once the server has made it, and its answer carries the key the dialog shows once.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import { cacheUpdate, optimistic } from '~/lib/queries/query'
import { createApiKey, listApiKeys, revokeApiKey } from '~/server/auth/auth.functions'
import type { CreateApiKeyInput } from '~/server/auth/auth.schemas'

export type ApiKey = Awaited<ReturnType<typeof listApiKeys>>[number]

export const apiKeysQuery = queryOptions({
  queryKey: ['api-keys'],
  queryFn: () => listApiKeys(),
})

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: CreateApiKeyInput) => createApiKey({ data: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: apiKeysQuery.queryKey }),
  }))
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (key: ApiKey) => revokeApiKey({ data: { id: key.id } }),
    ...optimistic(queryClient, [
      cacheUpdate<ApiKey[], ApiKey>(apiKeysQuery.queryKey, (keys, revoked) =>
        keys.filter((k) => k.id !== revoked.id),
      ),
    ]),
  }))
}
