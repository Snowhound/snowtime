/// <reference types="bun" />

import { expect, test } from 'bun:test'
import { appUrls } from './app-url'

test('outside previews the app URL is BETTER_AUTH_URL', () => {
  expect(
    appUrls({ BETTER_AUTH_URL: 'https://snowtime.example', VERCEL_ENV: 'production' }),
  ).toEqual({ appUrl: 'https://snowtime.example', trustedOrigins: [] })
  expect(() => appUrls({})).toThrow('BETTER_AUTH_URL')
})

test('a preview uses its branch URL and trusts its deployment URL', () => {
  expect(
    appUrls({
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'snowtime-git-x-team.vercel.app',
      VERCEL_URL: 'snowtime-abc123-team.vercel.app',
    }),
  ).toEqual({
    appUrl: 'https://snowtime-git-x-team.vercel.app',
    trustedOrigins: ['https://snowtime-abc123-team.vercel.app'],
  })
})

test('a preview refuses BETTER_AUTH_URL and needs its branch URL', () => {
  expect(() =>
    appUrls({
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'b.vercel.app',
      BETTER_AUTH_URL: 'https://snowtime.example',
    }),
  ).toThrow('Leave BETTER_AUTH_URL unset')
  expect(() => appUrls({ VERCEL_ENV: 'preview' })).toThrow('VERCEL_BRANCH_URL')
})
