/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { AppError, errorMessages } from './errors'

test('message keys are snake_case, so they can serve as Paraglide message ids', () => {
  for (const key of Object.keys(errorMessages)) expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/)
})

test('an AppError carries its key and the English text as its message', () => {
  const error = new AppError('CONFLICT', 'project_name_taken')
  expect(error).toMatchObject({ code: 'CONFLICT', key: 'project_name_taken' })
  expect(error.message).toBe('A project with this name already exists.')
})
