import { describe, expect, it } from 'vitest'
import { cookieName } from '~/paraglide/runtime.js'
import { storesLocale } from './locale-cookie'

describe('storesLocale', () => {
  it("skips the browser's own language when there is no cookie", () => {
    expect(storesLocale('en', '', 'en')).toBe(false)
    expect(storesLocale('et', 'other=1', 'et')).toBe(false)
  })

  it('stores a language that differs from the browser', () => {
    expect(storesLocale('et', '', 'en')).toBe(true)
  })

  it('changes or renews an existing cookie', () => {
    expect(storesLocale('en', `other=1; ${cookieName}=et`, 'en')).toBe(true)
    expect(storesLocale('et', `${cookieName}=et`, 'et')).toBe(true)
  })
})
