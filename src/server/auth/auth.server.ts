// What the rest of the server needs from Better Auth, so that only this folder imports it:
// the request's session, the calls that go through Better Auth, its HTTP handler, and its
// refusals as the API sends them.
import { APIError } from 'better-auth/api'
import type { Database } from '~/db'
import { SEED_PASSWORD, seedUsers } from '~/db/seed'
import { companyUsers } from '~/db/seed-company'
import { appUrl, env } from '~/env'
import type { WireError } from '~/lib/api/wire'
import { AppError } from '../errors'
import { rateLimits } from '../limits.server'
import type { Scope } from '../scope.server'
import type { GetInvitationInput, InviteMemberInput } from './auth.schemas'
import { auth, rateLimitStore, sessionOf } from './better-auth.server'
import * as invitations from './invitations.server'
import { appSession } from './session.server'
import { passwordEnabled } from './sign-in.server'

// Better Auth's own routes, under /api/auth.
export function handleAuthRequest(request: Request) {
  return auth.handler(request)
}

// The signed-in user of a request, counting a write against their rate.
export async function signedInUser(headers: Headers, write: boolean) {
  const session = await sessionOf(headers)
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'sign_in_required')
  }
  const { userId } = session.session
  if (write) {
    const { allowed } = await rateLimitStore.consume(`write:${userId}`, rateLimits.writesPerUser)
    if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
  }
  return userId
}

// Better Auth's own refusal, as its HTTP API sends it, or null for any other error.
export function authRefusal(error: unknown): { status: number; error: WireError } | null {
  if (!(error instanceof APIError)) return null
  return { status: error.statusCode, error: { code: error.body?.code, message: error.message } }
}

// The signed-in user, their organizations and settings, or null when signed out. Reading it
// keeps the account's state as it is: it returns the fallback organization without saving
// it, and the browser stores the account's language.
export async function getAppSession(db: Database, headers: Headers) {
  const session = await sessionOf(headers)
  if (!session) return null
  const { user } = session
  const state = await appSession(db, user, session.session.activeOrganizationId ?? null)
  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    signedInAt: session.session.createdAt,
    ...state,
    appUrl: new URL(appUrl).origin,
  }
}

export function getDeployment() {
  return { demoMode: env.DEMO_MODE, allowedDomains: env.ALLOWED_LOGIN_DOMAINS ?? [] }
}

// The seeded users the sign-in page lists, empty wherever password sign-in is off. The
// company's users are listed once `bun run db:seed --company` has added them.
export async function getDevUsers(db: Database) {
  if (!passwordEnabled(env)) return []
  const company = await db.query.user.findMany({
    columns: { email: true },
    where: { email: { in: companyUsers.map((u) => u.email) } },
  })
  const seeded = new Set(company.map((u) => u.email))
  return [...seedUsers, ...companyUsers.filter((u) => seeded.has(u.email))].map((u) => ({
    name: u.name,
    email: u.email,
    password: SEED_PASSWORD,
  }))
}

export async function inviteMember(
  db: Database,
  scope: Scope,
  input: InviteMemberInput,
  headers: Headers,
) {
  const { allowed } = await rateLimitStore.consume(
    `invite:${scope.userId}`,
    rateLimits.inviteMember,
  )
  if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
  const { id, email, expiresAt } = await invitations.inviteMember(db, scope, input, () =>
    auth.api.createInvitation({
      headers,
      body: { email: input.email, role: input.role, organizationId: scope.organizationId },
    }),
  )
  return { id, email, expiresAt }
}

export function acceptInvitation(
  db: Database,
  userId: string,
  input: GetInvitationInput,
  headers: Headers,
) {
  return invitations.acceptInvitation(db, userId, input.id, () =>
    auth.api.acceptInvitation({ headers, body: { invitationId: input.id } }),
  )
}
