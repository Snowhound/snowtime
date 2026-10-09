import { Hono } from 'hono'
import { input, keys, type OrganizationEnv, run } from '../http.server'
import {
  CreateEntryInput,
  DeleteEntryInput,
  GetFirstEntryStartInput,
  ListEntriesInput,
  UpdateEntryInput,
} from './entries.schemas'
import * as entries from './entries.server'

export const entryRoutes = new Hono<OrganizationEnv>()
  .get('/entries', keys, input(ListEntriesInput), (c) => run(c, entries.listEntries))
  .get('/entries/first-start', input(GetFirstEntryStartInput), (c) =>
    run(c, entries.getFirstEntryStart),
  )
  .post('/entries', input(CreateEntryInput), (c) => run(c, entries.createEntry))
  .patch('/entries/:id', input(UpdateEntryInput), (c) => run(c, entries.updateEntry))
  .delete('/entries/:id', input(DeleteEntryInput), (c) => run(c, entries.deleteEntry))
