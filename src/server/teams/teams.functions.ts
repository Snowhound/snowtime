// Team server functions. Thin wrappers: the rules live in teams.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { scopeMiddleware } from '../middleware'
import {
  CreateTeamInput,
  RenameTeamInput,
  TeamIdInput,
  TeamMemberInput,
  SetTeamRoleInput,
} from './teams.schemas'
import * as teams from './teams.server'

export const setTeamRole = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(SetTeamRoleInput)
  .handler(({ data, context }) => teams.setTeamRole(db, context.scope, data))

export const listMembers = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .handler(({ context }) => teams.listMembers(db, context.scope))

export const listTeams = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .handler(({ context }) => teams.listTeams(db, context.scope))

export const createTeam = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(CreateTeamInput)
  .handler(({ data, context }) => teams.createTeam(db, context.scope, data))

export const renameTeam = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(RenameTeamInput)
  .handler(({ data, context }) => teams.renameTeam(db, context.scope, data))

export const deleteTeam = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(TeamIdInput)
  .handler(({ data, context }) => teams.deleteTeam(db, context.scope, data))

export const addTeamMember = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(TeamMemberInput)
  .handler(({ data, context }) => teams.addTeamMember(db, context.scope, data))

export const removeTeamMember = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(TeamMemberInput)
  .handler(({ data, context }) => teams.removeTeamMember(db, context.scope, data))
