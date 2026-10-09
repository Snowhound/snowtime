// The JSON API (task 084): each domain's routes behind the checks in http.server.ts, over
// HTTP, and in process for Start's server render (src/server-entry.ts). Clients outside the
// browser call it with a personal API key (docs/api.md). The native backend serves the same
// API, and the conformance tests (conformance/) check both.
import { Hono } from 'hono'
import {
  accountRoutes,
  invitationRoutes,
  organizationRoutes,
  publicAuthRoutes,
} from './auth/auth.routes'
import { availabilityRoutes } from './availability/availability.routes'
import { entryRoutes } from './entries/entries.routes'
import { known, organization, refused, signedIn } from './http.server'
import { projectRoutes } from './projects/projects.routes'
import { reportRoutes } from './reports/reports.routes'
import { settingsRoutes } from './settings/settings.routes'
import { teamRoutes } from './teams/teams.routes'
import { organizationTimerRoutes, timerRoutes } from './timer/timer.routes'
import { serverTiming, withTiming } from './timing.server'

const inOrganization = '/organizations/:organizationId'

// Hono runs a request's middleware and routes in the order they are added here, and a route
// ends the request, so the routes added before signedIn need no session.
export const api = new Hono()
  .basePath('/api/v1')
  .use(known)
  .route('/', publicAuthRoutes)
  .route('/', availabilityRoutes)
  .use(signedIn)
  .route('/', timerRoutes)
  .route('/', settingsRoutes)
  .route('/', accountRoutes)
  .route('/', invitationRoutes)
  .use(`${inOrganization}/*`, organization)
  .route(inOrganization, organizationRoutes)
  .route(inOrganization, organizationTimerRoutes)
  .route(inOrganization, entryRoutes)
  .route(inOrganization, projectRoutes)
  .route(inOrganization, reportRoutes)
  .route(inOrganization, teamRoutes)
  .onError(refused)

export function handleApiRequest(request: Request): Promise<Response> {
  return withTiming(async () => {
    const response = await api.fetch(request)
    response.headers.set('cache-control', 'no-store')
    response.headers.set('server-timing', serverTiming(['session', 'db']))
    return response
  })
}
