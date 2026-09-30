// The Country setting (docs/architecture/data.md, "Working days"): the countries with holiday data,
// and 'other' for weekends only. Without a saved country, the time zone gives a guess. The
// server and the browser both use it, so they count the same working days.
import type { Region } from './holidays'

export const COUNTRIES = ['EE', 'US', 'other'] as const
export type Country = (typeof COUNTRIES)[number]

// The US's zones in tzdata (zone1970.tab) with their aliases, without the territories, whose
// public holidays differ. Any zone other than these and Europe/Tallinn guesses 'other'.
const US_ZONES = [
  // Eastern
  'America/New_York',
  'US/Eastern',
  'EST5EDT',
  'America/Detroit',
  'US/Michigan',
  'America/Kentucky/Louisville',
  'America/Louisville',
  'America/Kentucky/Monticello',
  'America/Indiana/Indianapolis',
  'America/Indianapolis',
  'America/Fort_Wayne',
  'US/East-Indiana',
  'America/Indiana/Vincennes',
  'America/Indiana/Winamac',
  'America/Indiana/Marengo',
  'America/Indiana/Petersburg',
  'America/Indiana/Vevay',
  // Central
  'America/Chicago',
  'US/Central',
  'CST6CDT',
  'America/Indiana/Tell_City',
  'America/Indiana/Knox',
  'America/Knox_IN',
  'US/Indiana-Starke',
  'America/Menominee',
  'America/North_Dakota/Center',
  'America/North_Dakota/New_Salem',
  'America/North_Dakota/Beulah',
  // Mountain
  'America/Denver',
  'US/Mountain',
  'MST7MDT',
  'America/Shiprock',
  'Navajo',
  'America/Boise',
  'America/Phoenix',
  'US/Arizona',
  'MST',
  // Pacific
  'America/Los_Angeles',
  'US/Pacific',
  'PST8PDT',
  // Alaska and Hawaii
  'America/Anchorage',
  'US/Alaska',
  'America/Juneau',
  'America/Sitka',
  'America/Metlakatla',
  'America/Yakutat',
  'America/Nome',
  'America/Adak',
  'US/Aleutian',
  'America/Atka',
  'Pacific/Honolulu',
  'US/Hawaii',
  'Pacific/Johnston',
]

const ZONE_COUNTRIES = new Map<string, Country>([
  ['Europe/Tallinn', 'EE'],
  ...US_ZONES.map((zone) => [zone, 'US'] as const),
])

export function countryFromZone(timeZone: string): Country {
  return ZONE_COUNTRIES.get(timeZone) ?? 'other'
}

// The region whose working days count for the user: the saved country, else the guess.
export function userRegion(settings: { country: Country | null; timeZone: string }): Region {
  return settings.country ?? countryFromZone(settings.timeZone)
}
