/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { CreateProjectInput, ListProjectsInput } from './projects/projects.schemas'
import { parseOrganizationInput } from './schemas'

// scopeMiddleware's input: it runs on the call's whole data, before the function's schema.
describe('parseOrganizationInput', () => {
  test('passes the whole input on, for the function to parse', () => {
    const input = { organizationId: 'org-a', id: 'x', name: 'Design' }
    expect(parseOrganizationInput(input)).toBe(input)
  })

  test('refuses a call that names no organization', () => {
    expect(() => parseOrganizationInput({} as never)).toThrow(v.ValiError)
    expect(() => parseOrganizationInput({ organizationId: '' })).toThrow(v.ValiError)
    expect(() => parseOrganizationInput({ organizationId: 1 } as never)).toThrow(v.ValiError)
    expect(() => parseOrganizationInput(undefined as never)).toThrow(v.ValiError)
  })

  test("the functions' own schemas drop the organization again", () => {
    const id = '01900000-0000-7000-8000-000000000000'
    expect(v.parse(CreateProjectInput, { organizationId: 'org-a', id, name: 'Design' })).toEqual({
      id,
      name: 'Design',
      color: null,
    })
    expect(v.parse(ListProjectsInput, { organizationId: 'org-a' })).toEqual({
      includeArchived: false,
    })
  })
})
