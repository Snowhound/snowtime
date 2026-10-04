import { Hono } from 'hono'
import { db } from '~/db'
import { databaseAvailable } from './availability.server'

// Whether the app can serve pages, which the maintenance page polls during an outage. It
// reads no session, since the database may be down.
export const availabilityRoutes = new Hono().get('/availability', async (c) =>
  c.json(await databaseAvailable(db)),
)
