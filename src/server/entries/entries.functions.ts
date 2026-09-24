// Time entry server functions. Thin wrappers: the rules live in entries.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { scopeMiddleware } from '../middleware'
import {
  CreateEntryInput,
  DeleteEntryInput,
  ListEntriesInput,
  UpdateEntryInput,
} from './entries.schemas'
import * as entries from './entries.server'

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
