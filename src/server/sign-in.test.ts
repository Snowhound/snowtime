/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { signInMethods, socialProviders } from './sign-in.server'

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
