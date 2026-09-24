import { describe, expect, test } from 'bun:test'
// oxlint-disable-next-line import/no-relative-parent-imports -- messages/ is outside src/, so ~/ can't reach it.
import en from '../../messages/en.json'
// oxlint-disable-next-line import/no-relative-parent-imports -- as above.
import et from '../../messages/et.json'
import { AppError, errorMessages, type AppErrorKey } from '~/server/errors'
import { errorMessage } from './errors'

const keys = Object.keys(errorMessages) as AppErrorKey[]

describe('error messages', () => {
  test("the server's English text matches the English message", () => {
    for (const key of keys) {
      expect(en[`error_${key}` as keyof typeof en]).toBe(errorMessages[key])
    }
  })

  test('every message has an Estonian translation', () => {
    expect(Object.keys(et).sort()).toEqual(Object.keys(en).sort())
  })

  test('an AppError shows its message, anything else a generic one', () => {
    expect(errorMessage(new AppError('NOT_FOUND', 'entry_not_found'))).toBe('Entry not found.')
    expect(errorMessage(new Error('SQLITE_BUSY'))).toBe(en.error_unexpected)
  })
})
