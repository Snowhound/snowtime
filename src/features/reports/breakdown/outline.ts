// Breakdown's outline: the report's rows by the chosen grouping, each with its time split by
// member, or by project when grouping by member. Project and ticket pairs come from
// getReportBreakdown; a team's members from team membership and the report's member totals.
import type { Access, Group } from '../filters'
import type { Report, ReportBreakdown } from '../queries'
import { type Row, type RowNames, inNoTeam, memberName, projectLabel } from '../rows'

export interface OutlineRow {
  key: string
  name: string
  // Projects have a dot; null is the "No project" row's muted one.
  color?: string | null
  muted?: boolean
  total: number
}

export interface OutlineGroup extends OutlineRow {
  children: OutlineRow[]
}

// The second level: members for projects, tickets, and teams, projects for members. Members
// see one level, since all the time is theirs.
export function subgroupOf(group: Group, access: Access): 'member' | 'project' | null {
  if (access.kind === 'member') return null
  return group === 'member' ? 'project' : 'member'
}

// Whether the outline needs getReportBreakdown's pairs.
export function needsPairs(group: Group, access: Access) {
  return subgroupOf(group, access) !== null && group !== 'team'
}

function byTotal(a: OutlineRow, b: OutlineRow) {
  return b.total - a.total || a.name.localeCompare(b.name)
}

export function outline(
  rows: Row[],
  group: Group,
  access: Access,
  report: Report,
  pairs: ReportBreakdown | undefined,
  names: RowNames,
): OutlineGroup[] {
  const sub = subgroupOf(group, access)
  function member(userId: string, total: number): OutlineRow {
    return { key: userId, name: memberName(userId, names), total }
  }
  function childrenOf(row: Row): OutlineRow[] {
    if (!sub) return []
    if (group === 'project') {
      return (pairs?.projects ?? [])
        .filter((p) => (p.projectId ?? 'none') === row.key)
        .map((p) => member(p.userId, p.total))
    }
    if (group === 'ticket') {
      return (pairs?.tickets ?? [])
        .filter((p) => (p.ticket ?? 'none') === row.key)
        .map((p) => member(p.userId, p.total))
    }
    if (group === 'member') {
      return (pairs?.projects ?? [])
        .filter((p) => p.userId === row.key)
        .map((p) => ({ ...projectLabel(p.projectId, names), total: p.total }))
    }
    const inTeam =
      row.key === 'none'
        ? inNoTeam(names)
        : (userId: string) =>
            names.teams.find((t) => t.id === row.key)?.members.some((m) => m.userId === userId)
    return report.members.filter((m) => inTeam(m.userId)).map((m) => member(m.userId, m.total))
  }
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    color: row.color,
    muted: row.muted,
    total: row.total,
    children: childrenOf(row).sort(byTotal),
  }))
}
