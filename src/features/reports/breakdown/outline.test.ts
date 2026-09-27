import { describe, expect, test } from 'bun:test'
import type { Member } from '~/lib/queries/members'
import type { Project } from '~/lib/queries/projects'
import type { Team } from '~/lib/queries/teams'
import type { Access, Group } from '../filters'
import type { Report, ReportBreakdown } from '../queries'
import { type RowNames, reportRows } from '../rows'
import { needsPairs, outline, subgroupOf } from './outline'

const HOUR = 3_600_000
const ME = 'u-me'
const KADRI = 'u-kadri'
const LIIS = 'u-liis'

const names: RowNames = {
  userId: ME,
  admin: true,
  projects: [{ id: 'p-web', name: 'Website', color: '#3b82b8' }] as Project[],
  teams: [
    {
      id: 't-platform',
      name: 'Platform',
      members: [
        { userId: ME, role: 'lead' },
        { userId: KADRI, role: 'member' },
      ],
    },
  ] as Team[],
  members: [
    { userId: ME, name: 'Max Member' },
    { userId: KADRI, name: 'Kadri Tamm' },
    { userId: LIIS, name: 'Liis Mets' },
  ] as Member[],
}

function totals(total: number) {
  return { total, perBucket: [total] }
}

const report = {
  ...totals(10 * HOUR),
  unit: 'day',
  buckets: ['2026-09-21'],
  trackedDays: 1,
  projects: [
    { projectId: 'p-web', ...totals(7 * HOUR) },
    { projectId: null, ...totals(3 * HOUR) },
  ],
  tickets: [
    { ticket: 'NBW-1', ...totals(4 * HOUR) },
    { ticket: null, ...totals(6 * HOUR) },
  ],
  members: [
    { userId: ME, ...totals(5 * HOUR) },
    { userId: KADRI, ...totals(3 * HOUR) },
    { userId: LIIS, ...totals(2 * HOUR) },
  ],
  teams: [{ teamId: 't-platform', ...totals(8 * HOUR) }],
} as unknown as Report

const pairs: ReportBreakdown = {
  projects: [
    { projectId: 'p-web', userId: ME, total: 4 * HOUR },
    { projectId: 'p-web', userId: KADRI, total: 3 * HOUR },
    { projectId: null, userId: LIIS, total: 2 * HOUR },
    { projectId: null, userId: ME, total: HOUR },
  ],
  tickets: [
    { ticket: 'NBW-1', userId: KADRI, total: 3 * HOUR },
    { ticket: 'NBW-1', userId: ME, total: HOUR },
    { ticket: null, userId: ME, total: 4 * HOUR },
    { ticket: null, userId: LIIS, total: 2 * HOUR },
  ],
}

const admin: Access = { kind: 'admin' }

// Each group's name and its children as "name total-in-hours".
function shape(group: Group, access: Access = admin) {
  return outline(reportRows(report, group, names), group, access, report, pairs, names).map((g) => [
    g.name,
    g.children.map((c) => `${c.name} ${c.total / HOUR}`),
  ])
}

describe('outline', () => {
  test('splits projects and tickets by member', () => {
    expect(shape('project')).toEqual([
      ['Website', ['Max Member (you) 4', 'Kadri Tamm 3']],
      ['No project', ['Liis Mets 2', 'Max Member (you) 1']],
    ])
    expect(shape('ticket')).toEqual([
      ['No ticket', ['Max Member (you) 4', 'Liis Mets 2']],
      ['NBW-1', ['Kadri Tamm 3', 'Max Member (you) 1']],
    ])
  })

  test('splits members by project', () => {
    const [me] = outline(reportRows(report, 'member', names), 'member', admin, report, pairs, names)
    expect(me.children).toEqual([
      { key: 'p-web', name: 'Website', color: '#3b82b8', muted: false, total: 4 * HOUR },
      { key: 'none', name: 'No project', color: null, muted: true, total: HOUR },
    ])
  })

  test('splits teams by their current members, and "No team" by those in none', () => {
    expect(shape('team')).toEqual([
      ['Platform', ['Max Member (you) 5', 'Kadri Tamm 3']],
      ['No team', ['Liis Mets 2']],
    ])
    expect(needsPairs('team', admin)).toBe(false)
  })

  test('members see one level and need no pairs', () => {
    const member: Access = { kind: 'member' }
    expect(subgroupOf('project', member)).toBeNull()
    expect(needsPairs('ticket', member)).toBe(false)
    expect(shape('project', member)).toEqual([
      ['Website', []],
      ['No project', []],
    ])
  })
})
