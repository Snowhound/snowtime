import { Hono } from 'hono'
import { db } from '~/db'
import { env } from '~/env'
import { input, type OrganizationEnv, run, type UserEnv } from '../http.server'
import { GetInvitationInput, InviteMemberInput, UpdateIssueLinksInput } from './auth.schemas'
import * as auth from './auth.server'
import * as invitations from './invitations.server'
import * as organizations from './organization.server'
import { signInMethods } from './sign-in.server'

// Calls that need no session: the sign-in page's, the session itself, and an invitation
// link's details, which anyone with the link may see before signing in.
export const publicAuthRoutes = new Hono()
  .get('/session', async (c) => c.json(await auth.getAppSession(db, c.req.raw.headers)))
  // Method ids only, never a client ID or secret.
  .get('/sign-in-methods', (c) => c.json(signInMethods(env)))
  .get('/deployment', (c) => c.json(auth.getDeployment()))
  .get('/dev-users', async (c) => c.json(await auth.getDevUsers(db)))
  .get('/invitations/:id', input(GetInvitationInput), async (c) =>
    c.json(await invitations.invitationPreview(db, c.var.input.id)),
  )

// Better Auth's own calls read the request's headers.
export const invitationRoutes = new Hono<UserEnv>().post(
  '/invitations/:id/accept',
  input(GetInvitationInput),
  async (c) =>
    c.json(await auth.acceptInvitation(db, c.var.userId, c.var.input, c.req.raw.headers)),
)

export const organizationRoutes = new Hono<OrganizationEnv>()
  // Better Auth's organization client can't set the app's own columns.
  .patch('/issue-links', input(UpdateIssueLinksInput), (c) =>
    run(c, organizations.updateIssueLinks),
  )
  .get('/invitations', (c) => run(c, invitations.listInvitations))
  .post('/invitations', input(InviteMemberInput), async (c) =>
    c.json(await auth.inviteMember(db, c.var.scope, c.var.input, c.req.raw.headers)),
  )
