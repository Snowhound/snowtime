/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { CreateProjectInput, ListProjectsInput } from './projects/projects.schemas'

// An organization's routes take its id from the path, and input() merges the path into the
// input the call's own schema parses.
describe('the organization in the input', () => {
  test("the calls' own schemas drop it again", () => {
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
