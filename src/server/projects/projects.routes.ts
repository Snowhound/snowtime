import { Hono } from 'hono'
import { input, keys, type OrganizationEnv, run } from '../http.server'
import {
  CreateProjectInput,
  ListProjectsInput,
  ProjectIdInput,
  ProjectTeamInput,
  UpdateProjectInput,
} from './projects.schemas'
import * as projects from './projects.server'

export const projectRoutes = new Hono<OrganizationEnv>()
  .get('/projects', keys, input(ListProjectsInput), (c) => run(c, projects.listProjects))
  .post('/projects', input(CreateProjectInput), (c) => run(c, projects.createProject))
  .patch('/projects/:id', input(UpdateProjectInput), (c) => run(c, projects.updateProject))
  .post('/projects/:id/archive', input(ProjectIdInput), (c) => run(c, projects.archiveProject))
  .post('/projects/:id/unarchive', input(ProjectIdInput), (c) => run(c, projects.unarchiveProject))
  .delete('/projects/:id', input(ProjectIdInput), (c) => run(c, projects.deleteProject))
  .put('/projects/:projectId/teams/:teamId', input(ProjectTeamInput), (c) =>
    run(c, projects.assignProjectToTeam),
  )
  .delete('/projects/:projectId/teams/:teamId', input(ProjectTeamInput), (c) =>
    run(c, projects.unassignProjectFromTeam),
  )
