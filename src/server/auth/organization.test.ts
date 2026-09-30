/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import type { Database } from '~/db'
import { seedIds } from '~/db/seed'
import { as, createSeededDatabase, scopeOf } from '../testing'
import { UpdateIssueLinksInput } from './auth.schemas'
import { updateIssueLinks } from './organization.server'

const { users: U, orgs: O } = seedIds

let db: Database
let cleanup: () => Promise<void>

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
})

afterAll(() => cleanup())

describe('updateIssueLinks', () => {
  test('admins and owners set and clear it', async () => {
    const scope = await scopeOf(db, U.admin, O.northwind)
    const input = v.parse(UpdateIssueLinksInput, {
      issueLinks: ' https://acme.youtrack.cloud/issue/{key} ',
    })
    expect(await as(scope, () => updateIssueLinks(db, scope, input))).toEqual({
      id: O.northwind,
      issueLinks: 'https://acme.youtrack.cloud/issue/{key}',
    })
    const cleared = v.parse(UpdateIssueLinksInput, { issueLinks: '' })
    expect(cleared.issueLinks).toBeNull()
    expect((await as(scope, () => updateIssueLinks(db, scope, cleared))).issueLinks).toBeNull()
  })

  test('members and team leads are refused', async () => {
    for (const userId of [U.member, U.lead]) {
      const scope = await scopeOf(db, userId, O.northwind)
      await expect(
        as(scope, () =>
          updateIssueLinks(db, scope, { issueLinks: 'https://x.example.com/browse/{key}' }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  test('takes an https:// address with {key}', () => {
    function error(issueLinks: string) {
      const result = v.safeParse(UpdateIssueLinksInput, { issueLinks })
      return result.success ? null : result.issues[0].message
    }
    expect(error('https://acme.atlassian.net/browse/{key}')).toBeNull()
    expect(error('https://linear.app/acme/issue/{key}')).toBeNull()
    for (const bad of [
      'http://acme.atlassian.net/browse/{key}',
      'acme.atlassian.net/browse/{key}',
      'https://localhost/browse/{key}',
      'https://acme.atlassian.net/browse/{key} x',
    ]) {
      expect(error(bad)).toContain('https://')
    }
    expect(error('https://acme.atlassian.net/browse/')).toContain('Put {key}')
  })
})
