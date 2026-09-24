// Settings server functions. Thin wrappers: the rules live in settings.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { sessionMiddleware } from '../middleware'
import { GetSettingsInput, UpdateSettingsInput } from './settings.schemas'
import * as settings from './settings.server'

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
