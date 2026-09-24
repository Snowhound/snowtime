// Time entry server functions. Thin wrappers: the rules live in src/server/entries.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import {
  CreateEntryInput,
  DeleteEntryInput,
  ListEntriesInput,
  UpdateEntryInput,
} from '~/schemas/entries'
import * as entries from '~/server/entries.server'
import { scopeMiddleware } from '~/server/middleware'

export const createEntry = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(CreateEntryInput)
  .handler(({ data, context }) => entries.createEntry(db, context.scope, data))

export const updateEntry = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(UpdateEntryInput)
  .handler(({ data, context }) => entries.updateEntry(db, context.scope, data))

export const deleteEntry = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(DeleteEntryInput)
  .handler(({ data, context }) => entries.deleteEntry(db, context.scope, data))

export const listEntries = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ListEntriesInput)
  .handler(({ data, context }) => entries.listEntries(db, context.scope, data))
