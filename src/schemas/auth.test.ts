/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { safeRedirect } from '~/lib/redirect'
import { CreateOrganizationForm, slugify } from './auth'

describe('slugify', () => {
  test('lowercases, drops accents, and joins words with single dashes', () => {
    expect(slugify('Northwind Studio')).toBe('northwind-studio')
    expect(slugify('Põhjamaade Logistika- ja Laohaldus OÜ')).toBe(
      'pohjamaade-logistika-ja-laohaldus-ou',
    )
    expect(slugify('  --Acme & Co.--  ')).toBe('acme-co')
  })

  test('a name without letters or digits gives an empty short name, which the form rejects', () => {
    expect(slugify('ÄÖ!?')).toBe('ao')
    expect(slugify('???')).toBe('')
    expect(v.is(CreateOrganizationForm, { name: '???', slug: '' })).toBe(false)
  })

  test('stays within the 48 characters the form allows, without a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(47)} b`)
    expect(slug).toBe('a'.repeat(47))
    expect(v.is(CreateOrganizationForm, { name: 'Long', slug: slugify('x '.repeat(60)) })).toBe(
      true,
    )
  })
})

describe('safeRedirect', () => {
  test('keeps paths on this site', () => {
    expect(safeRedirect('/reports?range=week')).toBe('/reports?range=week')
  })

  test('falls back for other origins and missing targets', () => {
    for (const target of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
    ]) {
      expect(safeRedirect(target)).toBe('/')
    }
  })
})
