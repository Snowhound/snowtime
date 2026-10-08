// Per-user settings: time zone, week start, UI language and view settings
// (docs/architecture/data.md, "Time zones", and docs/architecture/timer.md, "User settings").
// They belong to the user, not an organization, so these rules take the user id.
import { eq } from 'drizzle-orm'
import type { Database } from '~/db'
import { userSettings } from '~/db/schema'
import { inCollection } from '~/lib/scene/images'
import { AppError } from '../errors'
import type { CreateSettingsInput, UpdateSettingsInput } from './settings.schemas'

const columns = {
  timeZone: userSettings.timeZone,
  weekStart: userSettings.weekStart,
  locale: userSettings.locale,
  theme: userSettings.theme,
  timerLayout: userSettings.timerLayout,
  showSummary: userSettings.showSummary,
  compactRows: userSettings.compactRows,
  wideTimer: userSettings.wideTimer,
  timerView: userSettings.timerView,
  calendarWeekend: userSettings.calendarWeekend,
  appIcon: userSettings.appIcon,
  sceneCollection: userSettings.sceneCollection,
  scenePin: userSettings.scenePin,
  sceneBackground: userSettings.sceneBackground,
  sceneStrength: userSettings.sceneStrength,
  surfaces: userSettings.surfaces,
  sceneWeather: userSettings.sceneWeather,
  sceneIntro: userSettings.sceneIntro,
  sceneTagline: userSettings.sceneTagline,
  durationFormat: userSettings.durationFormat,
  dateFormat: userSettings.dateFormat,
  timeFormat: userSettings.timeFormat,
  copyDurationPattern: userSettings.copyDurationPattern,
  copyDurationControl: userSettings.copyDurationControl,
  country: userSettings.country,
}

export async function findSettings(db: Database, userId: string) {
  return (await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId))).at(0)
}

// Creates the user's settings, if they have none, with the browser's time zone and locale
// and a Monday week start, and returns them. Later calls ignore the input.
export async function createSettings(db: Database, userId: string, input: CreateSettingsInput) {
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
// fields, and an empty patch returns the settings unchanged. A collection has one pin, so
// choosing a collection clears it, and a pin must be one of the collection's images.
export async function updateSettings(db: Database, userId: string, input: UpdateSettingsInput) {
  if (input.sceneCollection !== undefined && input.scenePin === undefined) {
    input = { ...input, scenePin: null }
  }
  if (input.scenePin) {
    const collection =
      input.sceneCollection ?? (await findSettings(db, userId))?.sceneCollection ?? 'mountains'
    if (!inCollection(collection, input.scenePin)) {
      throw new AppError('INVALID', 'scene_pin_not_in_collection')
    }
  }
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
