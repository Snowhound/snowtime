import * as v from 'valibot'
import {
  type CreateEntriesInput,
  type CreateEntryInput,
  type DeleteEntriesInput,
  type DeleteEntryInput,
  Entry,
  type GetFirstEntryStartInput,
  type ListEntriesInput,
  type UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import { Timestamp } from '~/server/schemas'
import { request } from './request'

type In<S extends v.GenericSchema> = v.InferInput<S> & { organizationId: string }

function path(organizationId: string) {
  return `/api/v1/organizations/${organizationId}/entries`
}

export function listEntries({ organizationId, ...range }: In<typeof ListEntriesInput>) {
  return request('GET', path(organizationId), range, v.array(Entry))
}

export function getFirstEntryStart({
  organizationId,
  ...input
}: In<typeof GetFirstEntryStartInput>) {
  return request('GET', `${path(organizationId)}/first-start`, input, v.nullable(Timestamp))
}

export function createEntry({ organizationId, ...entry }: In<typeof CreateEntryInput>) {
  return request('POST', path(organizationId), entry, Entry)
}

// The entry's work at each of the times, saved together or not at all.
export function createEntries({ organizationId, ...input }: In<typeof CreateEntriesInput>) {
  return request('POST', `${path(organizationId)}/batch`, input, v.array(Entry))
}

export function updateEntry({ organizationId, id, ...patch }: In<typeof UpdateEntryInput>) {
  return request('PATCH', `${path(organizationId)}/${id}`, patch, Entry)
}

export function deleteEntry({ organizationId, id }: In<typeof DeleteEntryInput>) {
  return request('DELETE', `${path(organizationId)}/${id}`, undefined, v.object({ id: v.string() }))
}

export function deleteEntries({ organizationId, ...input }: In<typeof DeleteEntriesInput>) {
  return request(
    'POST',
    `${path(organizationId)}/batch-delete`,
    input,
    v.object({ ids: v.array(v.string()) }),
  )
}
