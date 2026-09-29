// The timesheet's rows: getReport's totals per project, ticket, team or member, named from the
// cached lists. Time without a project or ticket gets a "No project" or "No ticket" row; for
// admins, members in no team get a "No team" row.
import type { Member } from '~/lib/queries/members'
import type { Project } from '~/lib/queries/projects'
import type { Team } from '~/lib/queries/teams'
import { m } from '~/paraglide/messages.js'
import type { Locale } from '~/paraglide/runtime.js'
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
  // The user, named with "(you)"; an export for a client names no one so.
  userId?: string
  admin: boolean
  projects: Project[]
  teams: Team[]
  members: Member[]
  // The "No project", "No team", and "No ticket" rows' language, the UI's by default.
  locale?: Locale
}

// A project's row key and name; null is time without a project.
export function projectLabel(
  projectId: string | null,
  names: Pick<RowNames, 'projects' | 'locale'>,
) {
  const project = projectId ? names.projects.find((p) => p.id === projectId) : undefined
  return {
    key: projectId ?? 'none',
    name: project?.name ?? m.reports_no_project({}, { locale: names.locale }),
    color: project?.color ?? null,
    muted: !project,
  }
}

function projectRows(report: Report, names: RowNames): Row[] {
  return report.projects.map(({ projectId, total, perBucket }) => ({
    ...projectLabel(projectId, names),
    total,
    perBucket,
  }))
}

// A member's name, with "(you)" for the user.
export function memberName(userId: string, names: Pick<RowNames, 'userId' | 'members'>) {
  const name = names.members.find((m) => m.userId === userId)?.name ?? ''
  return userId === names.userId ? m.reports_you({ name }) : name
}

// Whether a member is in none of the organization's teams, the "No team" row.
export function inNoTeam(names: Pick<RowNames, 'teams'>) {
  const inTeams = new Set(names.teams.flatMap((t) => t.members.map((m) => m.userId)))
  return (userId: string) => !inTeams.has(userId)
}

function teamRows(report: Report, names: RowNames): Row[] {
  const rows: Row[] = report.teams.map(({ teamId, total, perBucket }) => ({
    key: teamId,
    name: names.teams.find((t) => t.id === teamId)?.name ?? '',
    total,
    perBucket,
  }))
  if (!names.admin) return rows
  const noTeam = inNoTeam(names)
  const alone = report.members.filter((r) => noTeam(r.userId))
  if (alone.length === 0) return rows
  return [
    ...rows,
    {
      key: 'none',
      name: m.reports_no_team({}, { locale: names.locale }),
      muted: true,
      total: alone.reduce((sum, r) => sum + r.total, 0),
      perBucket: report.buckets.map((_, i) => alone.reduce((sum, r) => sum + r.perBucket[i], 0)),
    },
  ]
}

function ticketRows(report: Report, names: RowNames): Row[] {
  return report.tickets.map(({ ticket, total, perBucket }) => ({
    key: ticket ?? 'none',
    name: ticket ?? m.reports_no_ticket({}, { locale: names.locale }),
    muted: !ticket,
    total,
    perBucket,
  }))
}

// Most time first, then by name.
export function reportRows(report: Report, group: Group, names: RowNames): Row[] {
  const rows =
    group === 'project'
      ? projectRows(report, names)
      : group === 'ticket'
        ? ticketRows(report, names)
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
