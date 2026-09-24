// Per-user settings: time zone, week start and UI language (docs/architecture.md, "Time zones"). They
// belong to the user, not an organization, so these rules take the user id.
import { eq } from 'drizzle-orm'
import type { Database } from '../db'
import { userSettings } from '../db/schema'
import type { GetSettingsInput, UpdateSettingsInput } from '../schemas/settings'
import { AppError } from './errors'

const columns = {
  timeZone: userSettings.timeZone,
  weekStart: userSettings.weekStart,
  locale: userSettings.locale,
}

// Returns the user's settings, creating them on the first call with the browser's time
// zone and locale and a Monday week start. Later calls ignore the input.
export async function getSettings(db: Database, userId: string, input: GetSettingsInput) {
  const [existing] = await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId))
  if (existing) return existing
  // A concurrent first call may insert first; either way the row now exists.
  await db
    .insert(userSettings)
    .values({ userId, timeZone: input.timeZone, locale: input.locale })
    .onConflictDoNothing()
  const [created] = await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId))
  return created
}

export async function updateSettings(db: Database, userId: string, input: UpdateSettingsInput) {
  const [updated] = await db
    .update(userSettings)
    .set({ timeZone: input.timeZone, weekStart: input.weekStart, locale: input.locale })
    .where(eq(userSettings.userId, userId))
    .returning(columns)
  if (!updated) throw new AppError('NOT_FOUND', 'settings_not_found')
  return updated
}
