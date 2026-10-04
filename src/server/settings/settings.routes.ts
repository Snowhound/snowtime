import { Hono } from 'hono'
import { input, run, type UserEnv } from '../http.server'
import { CreateSettingsInput, UpdateSettingsInput } from './settings.schemas'
import * as settings from './settings.server'

// Settings are per user, so they name no organization. A new user's are created by an
// explicit write, so the session read stays a read.
export const settingsRoutes = new Hono<UserEnv>()
  .put('/settings', input(CreateSettingsInput), (c) => run(c, settings.createSettings))
  .patch('/settings', input(UpdateSettingsInput), (c) => run(c, settings.updateSettings))
