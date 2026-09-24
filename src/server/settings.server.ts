// Per-user settings: time zone, week start, UI language and view settings
// (docs/architecture.md, "Time zones" and "User settings"). They belong to the user, not an
// organization, so these rules take the user id.
import { eq } from 'drizzle-orm'
import type { Database } from '../db'
import { userSettings } from '../db/schema'
import type { GetSettingsInput, UpdateSettingsInput } from '../schemas/settings'
import { AppError } from './errors'

const columns = {
  timeZone: userSettings.timeZone,
  weekStart: userSettings.weekStart,
  locale: userSettings.locale,
  theme: userSettings.theme,
  timerLayout: userSettings.timerLayout,
  showSummary: userSettings.showSummary,
}

async function findSettings(db: Database, userId: string) {
  const [row] = await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId))
  return row
}

// Returns the user's settings, creating them on the first call with the browser's time
// zone and locale and a Monday week start. Later calls ignore the input.
export async function getSettings(db: Database, userId: string, input: GetSettingsInput) {
  const existing = await findSettings(db, userId)
  if (existing) return existing
  // A concurrent first call may insert first; either way the row now exists.
  await db
    .insert(userSettings)
    .values({ userId, timeZone: input.timeZone, locale: input.locale })
    .onConflictDoNothing()
  return (await findSettings(db, userId))!
}

// Applies a partial patch; the UI saves one field at a time. Drizzle skips undefined
// fields, and an empty patch returns the settings unchanged.
export async function updateSettings(db: Database, userId: string, input: UpdateSettingsInput) {
  if (Object.values(input).every((value) => value === undefined)) {
    const current = await findSettings(db, userId)
    if (!current) throw new AppError('NOT_FOUND', 'settings_not_found')
    return current
  }
  const [updated] = await db
    .update(userSettings)
    .set(input)
    .where(eq(userSettings.userId, userId))
    .returning(columns)
  if (!updated) throw new AppError('NOT_FOUND', 'settings_not_found')
  return updated
}
