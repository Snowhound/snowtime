import type * as v from 'valibot'
import {
  type CreateSettingsInput,
  Settings,
  type UpdateSettingsInput,
} from '~/server/settings/settings.schemas'
import { request } from './request'

// A new user's settings are created by an explicit write, so the session read stays a read.
export function createSettings(input: v.InferInput<typeof CreateSettingsInput>) {
  return request('PUT', '/api/v1/settings', input, Settings)
}

export function updateSettings(input: v.InferInput<typeof UpdateSettingsInput>) {
  return request('PATCH', '/api/v1/settings', input, Settings)
}
