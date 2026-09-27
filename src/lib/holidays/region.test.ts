import { describe, expect, test } from 'bun:test'
import { countryFromZone, userRegion } from './region'

describe('countryFromZone', () => {
  test('guesses Estonia from Tallinn', () => {
    expect(countryFromZone('Europe/Tallinn')).toBe('EE')
  })

  test('guesses the United States from its zones and their aliases', () => {
    for (const zone of [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'US/Eastern',
      'US/Pacific',
      'US/Hawaii',
      'EST5EDT',
      'America/Phoenix',
      'America/Detroit',
      'America/Indiana/Indianapolis',
      'America/Boise',
      'America/Juneau',
      'America/Adak',
    ]) {
      expect({ zone, country: countryFromZone(zone) }).toEqual({ zone, country: 'US' })
    }
  })

  test('guesses other for any other zone', () => {
    for (const zone of [
      'Europe/Helsinki',
      'Europe/Riga',
      'America/Toronto',
      'America/Puerto_Rico',
      'Pacific/Guam',
      'UTC',
      'Asia/Tokyo',
    ]) {
      expect(countryFromZone(zone)).toBe('other')
    }
  })
})

describe('userRegion', () => {
  test('takes the saved country over the guess', () => {
    expect(userRegion({ country: 'US', timeZone: 'Europe/Tallinn' })).toBe('US')
    expect(userRegion({ country: 'other', timeZone: 'Europe/Tallinn' })).toBe('other')
    expect(userRegion({ country: null, timeZone: 'Europe/Tallinn' })).toBe('EE')
  })
})
