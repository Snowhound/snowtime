// Whether the app can serve pages, which the maintenance page polls during an outage.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { databaseAvailable } from './availability.server'

export const checkAvailability = createServerFn({ method: 'GET' }).handler(() =>
  databaseAvailable(db),
)
