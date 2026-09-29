import { describe, expect, test } from 'bun:test'
import { DEVICE_DEFAULTS, parseDeviceSettings, sameDeviceSettings } from './device-settings'

describe('device settings', () => {
  test('nothing stored, or not JSON, gives the defaults', () => {
    expect(parseDeviceSettings(null)).toEqual(DEVICE_DEFAULTS)
    expect(parseDeviceSettings('{not json')).toEqual(DEVICE_DEFAULTS)
    expect(parseDeviceSettings('"winter"')).toEqual(DEVICE_DEFAULTS)
    expect(parseDeviceSettings('null')).toEqual(DEVICE_DEFAULTS)
  })

  test('valid fields are kept and invalid ones fall back one by one', () => {
    const stored = JSON.stringify({
      theme: 'dark',
      appIcon: '13',
      sceneCollection: 'coast',
      scenePin: 'coast-march',
      sceneBackground: 'no',
      sceneStrength: 'full',
      surfaces: 'frosted',
      sceneWeather: false,
      sceneIntro: 0,
      extra: true,
    })
    expect(parseDeviceSettings(stored)).toEqual({
      ...DEVICE_DEFAULTS,
      theme: 'dark',
      sceneCollection: 'coast',
      scenePin: 'coast-march',
      sceneStrength: 'full',
      sceneWeather: false,
    })
  })

  test('a pin outside the collection is dropped', () => {
    const stored = JSON.stringify({ sceneCollection: 'countryside', scenePin: 'coast-march' })
    expect(parseDeviceSettings(stored)).toEqual({
      ...DEVICE_DEFAULTS,
      sceneCollection: 'countryside',
      scenePin: null,
    })
  })

  test('a season stored before collections reads as a pinned mountain image', () => {
    expect(parseDeviceSettings(JSON.stringify({ sceneSeason: 'winter' }))).toEqual({
      ...DEVICE_DEFAULTS,
      sceneCollection: 'mountains',
      scenePin: 'winter',
    })
    expect(parseDeviceSettings(JSON.stringify({ sceneSeason: 'auto' }))).toEqual(DEVICE_DEFAULTS)
    // Once a collection is stored, the old field no longer counts.
    const stored = JSON.stringify({ sceneSeason: 'winter', sceneCollection: 'coast' })
    expect(parseDeviceSettings(stored)).toEqual({ ...DEVICE_DEFAULTS, sceneCollection: 'coast' })
  })

  test('compares account values across refetches without equating changed choices', () => {
    const account = { ...DEVICE_DEFAULTS, scenePin: null }
    const refetched = { ...account }
    const device = { ...account, scenePin: 'winter' as const, theme: 'dark' as const }

    expect(sameDeviceSettings(account, refetched)).toBe(true)
    expect(sameDeviceSettings(account, device)).toBe(false)
    expect(sameDeviceSettings(null, account)).toBe(false)
    expect(sameDeviceSettings(null, null)).toBe(true)
  })
})
