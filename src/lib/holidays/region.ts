// The Country setting (docs/architecture.md, "Working days"): the countries with holiday data,
// and 'other' for weekends only. Without a saved country, the time zone gives a guess. The
// server and the browser both use it, so they count the same working days.
import type { Region } from './holidays'

export const COUNTRIES = ['EE', 'US', 'other'] as const
export type Country = (typeof COUNTRIES)[number]

// Each zone with its tzdata aliases; any other zone guesses 'other'.
const ZONE_COUNTRIES: Record<string, Country> = {
  'Europe/Tallinn': 'EE',
  'America/New_York': 'US',
  'US/Eastern': 'US',
  EST5EDT: 'US',
  'America/Chicago': 'US',
  'US/Central': 'US',
  CST6CDT: 'US',
  'America/Denver': 'US',
  'US/Mountain': 'US',
  MST7MDT: 'US',
  'America/Shiprock': 'US',
  Navajo: 'US',
  'America/Los_Angeles': 'US',
  'US/Pacific': 'US',
  PST8PDT: 'US',
  'America/Anchorage': 'US',
  'US/Alaska': 'US',
  'Pacific/Honolulu': 'US',
  'US/Hawaii': 'US',
  'Pacific/Johnston': 'US',
}

export function countryFromZone(timeZone: string): Country {
  return ZONE_COUNTRIES[timeZone] ?? 'other'
}

// The region whose working days count for the user: the saved country, else the guess.
export function userRegion(settings: { country: Country | null; timeZone: string }): Region {
  return settings.country ?? countryFromZone(settings.timeZone)
}
