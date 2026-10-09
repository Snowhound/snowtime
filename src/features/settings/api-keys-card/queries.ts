// The API keys card's query and mutations. Creating isn't optimistic: the list can only show
// a key once the server has made it, and its answer carries the key the dialog shows once.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import { createApiKey, listApiKeys, revokeApiKey } from '~/lib/api/auth'
import { cacheUpdate, optimistic } from '~/lib/queries/query'
import type { ApiKey, CreateApiKeyInput } from '~/server/auth/auth.schemas'

export const apiKeysQuery = queryOptions({
  queryKey: ['api-keys'],
  queryFn: () => listApiKeys(),
})

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: CreateApiKeyInput) => createApiKey(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: apiKeysQuery.queryKey }),
  }))
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (key: ApiKey) => revokeApiKey({ id: key.id }),
    ...optimistic(queryClient, [
      cacheUpdate<ApiKey[], ApiKey>(apiKeysQuery.queryKey, (keys, revoked) =>
        keys.filter((k) => k.id !== revoked.id),
      ),
    ]),
  }))
}
