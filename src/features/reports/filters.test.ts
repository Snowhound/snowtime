import { describe, expect, test } from 'bun:test'
import type { Member } from '~/lib/queries/members'
import type { Team } from '~/lib/queries/teams'
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

describe('reportFilters.entries', () => {
  test('a week of the timesheet narrows the range to its days in the report', () => {
    // September 2026 in weeks: its first week starts on Monday 31 August.
    const search: ReportSearch = {
      range: 'custom',
      from: '2026-09-01',
      to: '2026-10-31',
      unit: 'week',
      bucket: '2026-08-31',
    }
    const { entries } = reportFilters(search, context(MEMBER))
    expect(entries.bucket).toBe('2026-08-31')
    expect(entries.input.report).toMatchObject({ from: '2026-09-01', to: '2026-09-07' })
    // Six days open By day.
    expect(entries.view).toBe('day')
    // A day that starts no week of the report is dropped.
    const bad = reportFilters({ ...search, bucket: '2026-09-02' }, context(MEMBER))
    expect(bad.entries.bucket).toBeUndefined()
    expect(bad.entries.view).toBe('description')
  })

  test('opens By day for up to seven days, until the user picks a view', () => {
    const week = reportFilters({ range: 'this-week' }, context(MEMBER)).entries
    expect(week.view).toBe('day')
    const month = reportFilters({}, context(MEMBER)).entries
    expect(month).toMatchObject({ view: 'description', input: { view: 'description' } })
    const day = reportFilters({ bucket: '2026-09-10' }, context(MEMBER)).entries
    expect(day).toMatchObject({ view: 'day', input: { report: { from: '2026-09-10' } } })
    const chosen = reportFilters({ entries: 'day' }, context(MEMBER)).entries
    expect(chosen.view).toBe('day')
  })

  test('narrows to a row of the grouping the user may see', () => {
    const lead = context(LEAD)
    const member = reportFilters({ group: 'member', row: MEMBER }, lead).entries
    expect(member.input.row).toEqual({ group: 'member', id: MEMBER })
    // Team C isn't led by the user, and leads have no "No team" row.
    for (const row of [TEAM_C, 'none']) {
      expect(reportFilters({ group: 'team', row }, lead).entries.row).toBeUndefined()
    }
    expect(reportFilters({ group: 'team', row: 'none' }, context(OTHER, true)).entries.row).toBe(
      'none',
    )
    const project = reportFilters({ row: 'none' }, context(MEMBER)).entries
    expect(project.input.row).toEqual({ group: 'project', id: 'none' })
  })

  test('names people unless the list holds one person', () => {
    expect(reportFilters({}, context(MEMBER)).entries.many).toBe(false)
    expect(reportFilters({}, context(LEAD)).entries.many).toBe(true)
    expect(reportFilters({ member: MEMBER }, context(LEAD)).entries.many).toBe(false)
    expect(reportFilters({ group: 'member', row: MEMBER }, context(LEAD)).entries.many).toBe(false)
    expect(reportFilters({ row: 'none' }, context(LEAD)).entries.many).toBe(true)
  })
})
