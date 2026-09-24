// The timesheet's rows: getReport's totals per project, team or member, named from the
// cached lists. Time without a project gets a "No project" row; for admins, members in no
// team get a "No team" row.
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import type { Team } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import type { Group } from './filters'
import type { Report } from './queries'

export interface Row {
  key: string
  name: string
  // Projects have a dot; null is the "No project" row's muted one.
  color?: string | null
  // "No project" and "No team" read as muted.
  muted?: boolean
  total: number
  perBucket: number[]
}

export interface RowNames {
  userId: string
  admin: boolean
  projects: Project[]
  teams: Team[]
  members: Member[]
}

function projectRows(report: Report, names: RowNames): Row[] {
  return report.projects.map(({ projectId, total, perBucket }) => {
    const project = projectId ? names.projects.find((p) => p.id === projectId) : undefined
    return {
      key: projectId ?? 'none',
      name: project?.name ?? m.reports_no_project(),
      color: project?.color ?? null,
      muted: !project,
      total,
      perBucket,
    }
  })
}

function memberName(userId: string, names: RowNames) {
  const name = names.members.find((m) => m.userId === userId)?.name ?? ''
  return userId === names.userId ? m.reports_you({ name }) : name
}

function teamRows(report: Report, names: RowNames): Row[] {
  const rows: Row[] = report.teams.map(({ teamId, total, perBucket }) => ({
    key: teamId,
    name: names.teams.find((t) => t.id === teamId)?.name ?? '',
    total,
    perBucket,
  }))
  if (!names.admin) return rows
  const inTeams = new Set(names.teams.flatMap((t) => t.members.map((m) => m.userId)))
  const alone = report.members.filter((r) => !inTeams.has(r.userId))
  if (alone.length === 0) return rows
  return [
    ...rows,
    {
      key: 'none',
      name: m.reports_no_team(),
      muted: true,
      total: alone.reduce((sum, r) => sum + r.total, 0),
      perBucket: report.buckets.map((_, i) => alone.reduce((sum, r) => sum + r.perBucket[i], 0)),
    },
  ]
}

// Most time first, then by name.
export function reportRows(report: Report, group: Group, names: RowNames): Row[] {
  const rows =
    group === 'project'
      ? projectRows(report, names)
      : group === 'team'
        ? teamRows(report, names)
        : report.members.map(({ userId, total, perBucket }) => ({
            key: userId,
            name: memberName(userId, names),
            total,
            perBucket,
          }))
  return rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}
