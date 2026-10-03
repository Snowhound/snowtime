import { queryOptions } from '@tanstack/solid-query'
import * as v from 'valibot'
import { call } from '~/lib/api/client'
import { Uuidv7 } from '~/server/schemas'

// A malformed id can't match an invitation, so it shows as closed without asking.
export function invitationQuery(id: string) {
  return queryOptions({
    queryKey: ['invitation', id],
    queryFn: () => (v.is(Uuidv7, id) ? call('getInvitation', { id }) : null),
  })
}
