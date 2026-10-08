import { expect, test } from 'bun:test'
import { droppedActions } from './metrics'

test('rejects the observed pilot with global drops and an empty custom-step counter', () => {
  expect(
    droppedActions(
      {
        dropped_iterations: { values: { count: 56 } },
        'dropped_iterations{step:reports}': { values: { count: 0 } },
      },
      'reports',
    ),
  ).toBe(56)
})

test('detects scenario drops when the global counter is absent', () => {
  expect(
    droppedActions(
      {
        'dropped_iterations{scenario:reports}': { values: { count: 7 } },
        'dropped_iterations{step:reports}': { values: { count: 0 } },
      },
      'reports',
    ),
  ).toBe(7)
  expect(droppedActions({}, 'reports')).toBe(0)
})
