import { describe, expect, test } from 'bun:test'
import type { Member } from '~/lib/members'
import type { Team } from '~/lib/teams'
import { type ReportContext, type ReportSearch, reportFilters, requestedInput } from './filters'

const LEAD = '01900000-0000-7000-8000-000000000001'
const MEMBER = '01900000-0000-7000-8000-000000000002'
const OTHER = '01900000-0000-7000-8000-000000000003'
const TEAM_A = '01900000-0000-7000-8000-00000000000a'
const TEAM_B = '01900000-0000-7000-8000-00000000000b'
const TEAM_C = '01900000-0000-7000-8000-00000000000c'

const teams = [
  {
    id: TEAM_A,
    name: 'A',
    members: [
      { userId: LEAD, role: 'lead' },
      { userId: MEMBER, role: 'member' },
    ],
  },
  { id: TEAM_B, name: 'B', members: [{ userId: LEAD, role: 'lead' }] },
  { id: TEAM_C, name: 'C', members: [{ userId: OTHER, role: 'lead' }] },
] as Team[]
const members = [LEAD, MEMBER, OTHER].map((userId) => ({ userId })) as Member[]

function context(userId: string, admin = false): ReportContext {
  return { today: '2026-09-23', weekStart: 'mon', userId, admin, teams, members }
}

// The route loads requestedInput before teams and members, and the view reads
// reportFilters' input after: for every choice the user may make they must be the same
// query, or the view loads the report again.
describe('requestedInput', () => {
  const allowed: [string, ReportContext, ReportSearch][] = [
    ['the default range', context(MEMBER), {}],
    ['last month', context(MEMBER), { range: 'last-month' }],
    [
      'a custom range in weeks',
      context(LEAD),
      { range: 'custom', from: '2026-01-05', to: '2026-03-01', unit: 'week' },
    ],
    ['a led team', context(LEAD), { team: TEAM_B }],
    ["a led team's member", context(LEAD), { member: MEMBER }],
    ['any member, as an admin', context(OTHER, true), { member: LEAD, group: 'member' }],
    ['any team, as an admin', context(OTHER, true), { team: TEAM_A }],
  ]
  for (const [name, c, search] of allowed) {
    test(`matches the view's report for ${name}`, () => {
      expect(requestedInput(search, c)).toEqual(reportFilters(search, c).input)
    })
  }

  test('keeps a member or team the user may not choose, for getReport to refuse', () => {
    const search = { team: TEAM_C }
    expect(requestedInput(search, context(LEAD))).toMatchObject({ teamId: TEAM_C })
    expect(reportFilters(search, context(LEAD)).input.teamId).toBeUndefined()
  })

  test('asks for the member when the URL names both a member and a team', () => {
    const search = { member: MEMBER, team: TEAM_A }
    expect(requestedInput(search, context(OTHER, true))).toEqual(
      reportFilters(search, context(OTHER, true)).input,
    )
  })
})
