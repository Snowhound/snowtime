/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import {
  type MicrosoftClaims,
  microsoftEmailVerified,
  refuseUnverifiedSignUp,
  signInMethods,
  socialProviders,
} from './sign-in.server'

const production = { NODE_ENV: 'production' } as const

test('with no provider configured, production offers passkeys only', () => {
  expect(signInMethods(production)).toEqual(['passkey'])
})

test('password sign-in appears only in development', () => {
  expect(signInMethods({ NODE_ENV: 'development' })).toEqual(['password', 'passkey'])
  expect(signInMethods({ NODE_ENV: 'test' })).toEqual(['passkey'])
})

test('each provider appears when both its client ID and secret are set', () => {
  const all = {
    ...production,
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 'gs',
    GITHUB_CLIENT_ID: 'h',
    GITHUB_CLIENT_SECRET: 'hs',
    MICROSOFT_CLIENT_ID: 'm',
    MICROSOFT_CLIENT_SECRET: 'ms',
  }
  expect(signInMethods(all)).toEqual(['google', 'github', 'microsoft', 'passkey'])
  expect(
    signInMethods({ ...production, GITHUB_CLIENT_ID: 'h', GITHUB_CLIENT_SECRET: 'hs' }),
  ).toEqual(['github', 'passkey'])
})

test('a provider with only half its pair stays off', () => {
  expect(signInMethods({ ...production, MICROSOFT_CLIENT_ID: 'm' })).toEqual(['passkey'])
  expect(socialProviders({ ...production, GOOGLE_CLIENT_SECRET: 'gs' })).toEqual({})
})

test('the list carries ids only, never a configured value', () => {
  const secrets = { GOOGLE_CLIENT_ID: 'id-value', GOOGLE_CLIENT_SECRET: 'secret-value' }
  const json = JSON.stringify(signInMethods({ ...production, ...secrets }))
  expect(json).not.toContain('id-value')
  expect(json).not.toContain('secret-value')
})

test('the Microsoft tenant passes through only when set', () => {
  const microsoft = { ...production, MICROSOFT_CLIENT_ID: 'm', MICROSOFT_CLIENT_SECRET: 'ms' }
  expect(socialProviders(microsoft).microsoft).not.toHaveProperty('tenantId')
  expect(socialProviders({ ...microsoft, MICROSOFT_TENANT_ID: 't' }).microsoft).toMatchObject({
    tenantId: 't',
  })
})

describe('microsoftEmailVerified', () => {
  const work = { email: 'mari@corp.example', tid: '5e3f0b1c-2d4a-4e8b-9c1d-7a6b5c4d3e2f' }

  test("trusts a personal account's address and a domain the tenant verified", () => {
    expect(microsoftEmailVerified({ ...work, tid: '9188040d-6c67-4c5b-b112-36a304b66dad' })).toBe(
      true,
    )
    expect(microsoftEmailVerified({ ...work, xms_edov: true })).toBe(true)
  })

  test('trusts the claims Better Auth reads, when the app registration adds them', () => {
    expect(microsoftEmailVerified({ ...work, email_verified: true })).toBe(true)
    expect(microsoftEmailVerified({ ...work, verified_primary_email: [work.email] })).toBe(true)
    expect(
      microsoftEmailVerified({ ...work, verified_secondary_email: ['other@corp.example'] }),
    ).toBe(false)
  })

  test("doesn't trust a work address the tenant only typed in", () => {
    expect(microsoftEmailVerified(work)).toBe(false)
    expect(microsoftEmailVerified({ ...work, xms_edov: false })).toBe(false)
  })

  test('decides the verification Better Auth stores for a Microsoft sign-in', async () => {
    const { microsoft } = socialProviders({
      ...production,
      MICROSOFT_CLIENT_ID: 'm',
      MICROSOFT_CLIENT_SECRET: 'ms',
    })
    const claims: MicrosoftClaims = { ...work, xms_edov: true }
    expect(await microsoft?.mapProfileToUser(claims)).toEqual({ emailVerified: true })
  })
})

describe('refuseUnverifiedSignUp', () => {
  test('refuses a provider sign-up with an unverified address', async () => {
    await expect(
      refuseUnverifiedSignUp({ emailVerified: false }, { path: '/callback/:id' }),
    ).rejects.toMatchObject({ body: { code: 'EMAIL_UNVERIFIED' } })
    await expect(refuseUnverifiedSignUp({ emailVerified: false })).rejects.toMatchObject({
      body: { code: 'EMAIL_UNVERIFIED' },
    })
  })

  test("lets a verified address through, and development's password sign-up", async () => {
    await refuseUnverifiedSignUp({ emailVerified: true }, { path: '/callback/:id' })
    await refuseUnverifiedSignUp({ emailVerified: false }, { path: '/sign-up/email' })
  })
})
