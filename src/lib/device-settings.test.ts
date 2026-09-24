import { describe, expect, test } from 'bun:test'
import { DEVICE_DEFAULTS, parseDeviceSettings } from './device-settings'

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
      sceneSeason: 'winter',
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
      sceneSeason: 'winter',
      sceneStrength: 'full',
      sceneWeather: false,
    })
  })
})
