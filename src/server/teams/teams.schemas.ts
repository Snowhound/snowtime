import * as v from 'valibot'
import { Name } from '../auth/auth.schemas'
import { OrgRole, Timestamp, Uuidv7 } from '../schemas'

// Team leads read their team members' entries and reports (docs/architecture/data.md,
// "Tenancy"); a team can have several.
export const TEAM_ROLES = ['lead', 'member'] as const

export const SetTeamRoleInput = v.object({
  teamId: Uuidv7,
  userId: Uuidv7,
  role: v.picklist(TEAM_ROLES),
})
export type SetTeamRoleInput = v.InferOutput<typeof SetTeamRoleInput>

export const CreateTeamInput = v.object({ name: Name })
export type CreateTeamInput = v.InferOutput<typeof CreateTeamInput>
export const TeamIdInput = v.object({ teamId: Uuidv7 })
export type TeamIdInput = v.InferOutput<typeof TeamIdInput>
export const RenameTeamInput = v.object({ teamId: Uuidv7, name: Name })
export type RenameTeamInput = v.InferOutput<typeof RenameTeamInput>
export const TeamMemberInput = v.object({ teamId: Uuidv7, userId: Uuidv7 })
export type TeamMemberInput = v.InferOutput<typeof TeamMemberInput>

const TeamRole = v.picklist(TEAM_ROLES)

// The organization's teams by name, each with its members' team roles.
export const Team = v.object({
  id: v.string(),
  name: v.string(),
  members: v.array(v.object({ userId: v.string(), role: TeamRole })),
})
export type Team = v.InferOutput<typeof Team>

// The organization's members by name. `memberId` is what Better Auth's member calls take.
export const Member = v.object({
  memberId: v.string(),
  userId: v.string(),
  name: v.string(),
  email: v.string(),
  image: v.nullable(v.string()),
  joinedAt: Timestamp,
  orgRole: OrgRole,
  teams: v.array(v.object({ teamId: v.string(), role: TeamRole })),
})
export type Member = v.InferOutput<typeof Member>

export const TeamName = v.object({ id: v.string(), name: v.string() })
export const TeamMembership = v.object({ teamId: v.string(), userId: v.string(), role: TeamRole })
