import { Hono } from 'hono'
import { input, type OrganizationEnv, run } from '../http.server'
import {
  CreateTeamInput,
  RenameTeamInput,
  SetTeamRoleInput,
  TeamIdInput,
  TeamMemberInput,
} from './teams.schemas'
import * as teams from './teams.server'

export const teamRoutes = new Hono<OrganizationEnv>()
  .get('/teams', (c) => run(c, teams.listTeams))
  .post('/teams', input(CreateTeamInput), (c) => run(c, teams.createTeam))
  .patch('/teams/:teamId', input(RenameTeamInput), (c) => run(c, teams.renameTeam))
  .delete('/teams/:teamId', input(TeamIdInput), (c) => run(c, teams.deleteTeam))
  .put('/teams/:teamId/members/:userId', input(TeamMemberInput), (c) => run(c, teams.addTeamMember))
  .delete('/teams/:teamId/members/:userId', input(TeamMemberInput), (c) =>
    run(c, teams.removeTeamMember),
  )
  .patch('/teams/:teamId/members/:userId', input(SetTeamRoleInput), (c) =>
    run(c, teams.setTeamRole),
  )
  .get('/members', (c) => run(c, teams.listMembers))
