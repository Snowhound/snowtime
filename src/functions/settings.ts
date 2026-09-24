// Settings server functions. Thin wrappers: the rules live in src/server/settings.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '../db'
import { GetSettingsInput, UpdateSettingsInput } from '../schemas/settings'
import { sessionMiddleware } from '../server/middleware'
import * as settings from '../server/settings.server'

// Settings are per user, so they need no active organization. getSettings creates the row
// on the first call, and repeating it changes nothing.
export const getSettings = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .validator(GetSettingsInput)
  .handler(({ data, context }) => settings.getSettings(db, context.userId, data))

export const updateSettings = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .validator(UpdateSettingsInput)
  .handler(({ data, context }) => settings.updateSettings(db, context.userId, data))
