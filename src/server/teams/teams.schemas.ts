import * as v from 'valibot'
import { Uuidv7 } from '../schemas'

// Team leads read their team members' entries and reports (docs/architecture.md,
// "Tenancy"); a team can have several.
export const TEAM_ROLES = ['lead', 'member'] as const

export const SetTeamRoleInput = v.object({
  teamId: Uuidv7,
  userId: Uuidv7,
  role: v.picklist(TEAM_ROLES),
})
export type SetTeamRoleInput = v.InferOutput<typeof SetTeamRoleInput>
