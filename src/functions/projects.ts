// Project server functions. Thin wrappers: the rules live in src/server/projects.server.ts.
import { createServerFn } from '@tanstack/solid-start'
import { db } from '../db'
import {
  CreateProjectInput,
  ListProjectsInput,
  ProjectIdInput,
  ProjectTeamInput,
  UpdateProjectInput,
} from '../schemas/projects'
import { scopeMiddleware } from '../server/middleware'
import * as projects from '../server/projects.server'

export const createProject = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(CreateProjectInput)
  .handler(({ data, context }) => projects.createProject(db, context.scope, data))

export const updateProject = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(UpdateProjectInput)
  .handler(({ data, context }) => projects.updateProject(db, context.scope, data))

export const archiveProject = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(ProjectIdInput)
  .handler(({ data, context }) => projects.archiveProject(db, context.scope, data))

export const unarchiveProject = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(ProjectIdInput)
  .handler(({ data, context }) => projects.unarchiveProject(db, context.scope, data))

export const assignProjectToTeam = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(ProjectTeamInput)
  .handler(({ data, context }) => projects.assignProjectToTeam(db, context.scope, data))

export const unassignProjectFromTeam = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(ProjectTeamInput)
  .handler(({ data, context }) => projects.unassignProjectFromTeam(db, context.scope, data))

export const listProjects = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .validator(ListProjectsInput)
  .handler(({ data, context }) => projects.listProjects(db, context.scope, data))
