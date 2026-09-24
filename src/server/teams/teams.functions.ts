// Team server functions. Thin wrappers: the rules live in teams.server.ts.
// Creating teams, adding members and inviting people go through Better Auth's
// organization client instead.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '~/db'
import { scopeMiddleware } from '../middleware'
import { SetTeamRoleInput } from './teams.schemas'
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
