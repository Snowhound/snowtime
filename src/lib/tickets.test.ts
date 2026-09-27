/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { detectTicket, issueUrl, keysIn, TICKET_PATTERN, untick } from './tickets'

const none = new Set<string>()

describe('detectTicket', () => {
  test('a key at the start becomes the ticket and leaves the text', () => {
    expect(detectTicket('NBW-412 Fix the login redirect', none, null)).toEqual({
      description: 'Fix the login redirect',
      ticket: 'NBW-412',
    })
    expect(detectTicket('  NBW-412  ', none, null)).toEqual({ description: '', ticket: 'NBW-412' })
  })

  test('a key at the start replaces the ticket', () => {
    expect(detectTicket('CP-7 Review', none, 'NBW-412')).toEqual({
      description: 'Review',
      ticket: 'CP-7',
    })
  })

  test('takes brackets and a separator after the key', () => {
    for (const text of [
      '[NBW-412] Fix it',
      'NBW-412: Fix it',
      'NBW-412 - Fix it',
      'NBW-412 | Fix it',
      'NBW-412|Fix it',
      '[NBW-412]: Fix it',
      'NBW-412 — Fix it',
    ]) {
      expect(detectTicket(text, none, null)).toEqual({ description: 'Fix it', ticket: 'NBW-412' })
    }
  })

  test('a key at the start leaves the text only with a break after it', () => {
    expect(detectTicket('NBW-412x Fix it', none, null).ticket).toBeNull()
    expect(detectTicket('NBW-412.5 release', none, null)).toEqual({
      description: 'NBW-412.5 release',
      ticket: 'NBW-412',
    })
  })

  test('a later key stays in the text and becomes the ticket only when there is none', () => {
    expect(detectTicket('Pair with Erik on CP-91 flaky tests', none, null)).toEqual({
      description: 'Pair with Erik on CP-91 flaky tests',
      ticket: 'CP-91',
    })
    expect(detectTicket('Pair with Erik on CP-91 flaky tests', none, 'NBW-412')).toEqual({
      description: 'Pair with Erik on CP-91 flaky tests',
      ticket: 'NBW-412',
    })
  })

  test('with a key at the start, a second key stays text', () => {
    expect(detectTicket('NBW-412 Split from NBW-399', none, null)).toEqual({
      description: 'Split from NBW-399',
      ticket: 'NBW-412',
    })
  })

  test('a pasted issue link becomes its key', () => {
    expect(detectTicket('https://acme.atlassian.net/browse/NBW-412 fix it', none, null)).toEqual({
      description: 'fix it',
      ticket: 'NBW-412',
    })
    expect(
      detectTicket('Review https://linear.app/acme/issue/eng-12/login-fails', none, null),
    ).toEqual({ description: 'Review ENG-12', ticket: 'ENG-12' })
    expect(
      detectTicket('https://acme.youtrack.cloud/issue/SNOW-160/Ticket-chips', none, null),
    ).toEqual({ description: '', ticket: 'SNOW-160' })
    expect(detectTicket('See https://github.com/acme/app/issues/12', none, null)).toEqual({
      description: 'See https://github.com/acme/app/issues/12',
      ticket: null,
    })
  })

  test('standards stay text', () => {
    for (const text of [
      'UTF-8 CSV import',
      'ISO-8601 timestamps',
      'SHA-256 checksums',
      'COVID-19 leave',
      'Migrate the UTF-8 CSV import',
    ]) {
      expect(detectTicket(text, none, null)).toEqual({ description: text, ticket: null })
    }
    expect(detectTicket('UTF-8 fix for NBW-3', none, null).ticket).toBe('NBW-3')
  })

  test('other shapes are not keys', () => {
    for (const text of ['A-1 one letter', 'ab-12 lowercase', 'AB-0 zero', 'ABCDEFGHIJK-1 long']) {
      expect(detectTicket(text, none, null).ticket).toBeNull()
    }
    expect(detectTicket('Build x-AB-12-y', none, null).ticket).toBeNull()
  })

  test('keys the saved text had are not found again', () => {
    const saved = 'Q3-2026 planning'
    expect(detectTicket(saved, none, null).ticket).toBe('Q3-2026')
    expect(detectTicket(saved, new Set(keysIn(saved)), null)).toEqual({
      description: saved,
      ticket: null,
    })
    expect(detectTicket('Q3-2026 planning for NBW-9', new Set(keysIn(saved)), null)).toEqual({
      description: 'Q3-2026 planning for NBW-9',
      ticket: 'NBW-9',
    })
  })
})

describe('untick', () => {
  test('puts the key back at the start of the text', () => {
    expect(untick('Q3-2026', 'planning')).toEqual({ description: 'Q3-2026 planning', ticket: null })
    expect(untick('NBW-1', '')).toEqual({ description: 'NBW-1', ticket: null })
  })

  test('leaves the text alone when it still has the key', () => {
    expect(untick('CP-91', 'Pair on CP-91 tests')).toEqual({
      description: 'Pair on CP-91 tests',
      ticket: null,
    })
  })

  test('the key is then found only when it is not known', () => {
    const { description } = untick('Q3-2026', 'planning')
    expect(detectTicket(description, new Set(keysIn(description)), null).ticket).toBeNull()
  })
})

test('keysIn finds whole keys only', () => {
  expect(keysIn('NBW-1, [CP-22] and x-AB-3 or AB-4a')).toEqual(['NBW-1', 'CP-22'])
})

test('TICKET_PATTERN matches one whole key', () => {
  expect(TICKET_PATTERN.test('NBW-412')).toBe(true)
  expect(TICKET_PATTERN.test('NBW-412 ')).toBe(false)
  expect(TICKET_PATTERN.test('nbw-412')).toBe(false)
})

test('issueUrl fills in the key', () => {
  expect(issueUrl('https://acme.atlassian.net/browse/{key}', 'NBW-412')).toBe(
    'https://acme.atlassian.net/browse/NBW-412',
  )
  expect(issueUrl(null, 'NBW-412')).toBeNull()
})
