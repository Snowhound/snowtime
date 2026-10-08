/// <reference types="bun" />
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import * as schema from '~/db/schema'
import { SEED_PASSWORD, seedIds } from '~/db/seed'
import { createTeam, deleteTeam } from '../teams/teams.server'
import { as, createSeededDatabase, scopeOf } from '../testing'
import { invitationLimit } from './invitation-limit.server'
import { acceptInvitation, inviteMember, listInvitations } from './invitations.server'
import { memberRemovalHook } from './member-removal.server'

const { users: U, orgs: O, teams: T } = seedIds
let db: Database
let cleanup: () => Promise<void>
let auth: ReturnType<typeof instance>
function instance() {
  const removalHook = memberRemovalHook(db)
  return betterAuth({
    baseURL: 'http://localhost:3080',
    secret: 'team-tests-secret-at-least-32-characters',
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: { database: { generateId: () => uuidv7() } },
    emailAndPassword: { enabled: true },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        await removalHook(ctx)
      }),
    },
    plugins: [
      organization({
        requireEmailVerificationOnInvitation: true,
        invitationLimit: invitationLimit(db),
      }),
    ],
  })
}
beforeEach(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
  auth = instance()
})
afterEach(() => cleanup())

test('the invitation cap counts live pending rows beyond expired rows', async () => {
  const now = new Date()
  const base = { organizationId: O.harbor, role: 'member', inviterId: U.admin, createdAt: now }
  await db.insert(schema.invitation).values([
    ...Array.from({ length: 100 }, (_, i) => ({
      ...base,
      id: uuidv7(),
      email: `expired-${i}@example.com`,
      status: 'pending',
      expiresAt: new Date(now.getTime() - 1000),
    })),
    ...Array.from({ length: 99 }, (_, i) => ({
      ...base,
      id: uuidv7(),
      email: `live-${i}@example.com`,
      status: 'pending',
      expiresAt: new Date(now.getTime() + 86400000),
    })),
    {
      ...base,
      id: uuidv7(),
      email: 'accepted@example.com',
      status: 'accepted',
      expiresAt: new Date(now.getTime() + 86400000),
    },
    {
      ...base,
      id: uuidv7(),
      organizationId: O.northwind,
      email: 'other@example.com',
      status: 'pending',
      expiresAt: new Date(now.getTime() + 86400000),
    },
  ])
  expect(await invite('last-slot@example.com', null)).toMatchObject({
    email: 'last-slot@example.com',
  })
  await expect(invite('over-limit@example.com', null)).rejects.toMatchObject({
    statusCode: 403,
    body: { code: 'INVITATION_LIMIT_REACHED', message: 'Invitation limit reached' },
  })
  await expect(invite('last-slot@example.com', null)).rejects.toMatchObject({
    statusCode: 400,
    body: { code: 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION' },
  })
  await expect(invite('admin@example.com', null)).rejects.toMatchObject({
    statusCode: 400,
    body: { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION' },
  })
})
async function headers(email: string) {
  const response = await auth.api.signInEmail({
    body: { email, password: SEED_PASSWORD },
    returnHeaders: true,
  })
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  })
}
async function invite(email = 'noah@example.com', teamId: string | null = T.delivery) {
  const scope = await scopeOf(db, U.admin, O.harbor)
  const input = { email, role: 'member' as const, teamId }
  const signedIn = await headers('admin@example.com')
  const created = await inviteMember(db, scope, input, () =>
    auth.api.createInvitation({
      headers: signedIn,
      body: { email, role: input.role, organizationId: O.harbor },
    }),
  )
  return created
}
function memberships(userId: string) {
  return db
    .select({ teamId: schema.teamMember.teamId, role: schema.teamMember.role })
    .from(schema.teamMember)
    .where(eq(schema.teamMember.userId, userId))
}

describe('app invitations with the organization plugin without teams', () => {
  test('composing the removal hook preserves session responses', async () => {
    const signedOut = await auth.handler(new Request('http://localhost:3080/api/auth/get-session'))
    expect(await signedOut.json()).toBeNull()
    const signedIn = await headers('admin@example.com')
    expect(await auth.api.getSession({ headers: signedIn })).toMatchObject({
      user: { id: U.admin },
    })
  })

  test('stores and lists the app team; accepting adds the new member with the default role', async () => {
    const created = await invite()
    const scope = await scopeOf(db, U.admin, O.harbor)
    expect(await listInvitations(db, scope)).toContainEqual(
      expect.objectContaining({ id: created.id, teamId: T.delivery }),
    )
    const recipient = await headers('noah@example.com')
    await acceptInvitation(db, U.loner, created.id, () =>
      auth.api.acceptInvitation({ headers: recipient, body: { invitationId: created.id } }),
    )
    expect(await memberships(U.loner)).toEqual([{ teamId: T.delivery, role: 'member' }])
    expect(await scopeOf(db, U.loner, O.harbor)).toMatchObject({ orgRole: 'member' })
  })

  test('an organization-only invitation and an invitation whose team was deleted still work', async () => {
    for (const withTeam of [false, true]) {
      const scope = await scopeOf(db, U.admin, O.harbor)
      const email = withTeam ? 'lead@example.com' : 'noah@example.com'
      const created = await invite(email, withTeam ? T.delivery : null)
      if (withTeam) await deleteTeam(db, scope, { teamId: T.delivery })
      const recipient = await headers(email)
      const userId = withTeam ? U.lead : U.loner
      await acceptInvitation(db, userId, created.id, () =>
        auth.api.acceptInvitation({ headers: recipient, body: { invitationId: created.id } }),
      )
      expect((await memberships(userId)).some((m) => m.teamId === T.delivery)).toBe(false)
      expect(await scopeOf(db, userId, O.harbor)).toMatchObject({ orgRole: 'member' })
    }
  })

  test('foreign or missing teams and non-admin invitations are refused before calling auth', async () => {
    const scope = await scopeOf(db, U.admin, O.harbor)
    let called = false
    async function callback() {
      called = true
      return { id: uuidv7() }
    }
    for (const teamId of [T.design, uuidv7()])
      await expect(
        inviteMember(db, scope, { email: 'noah@example.com', role: 'member', teamId }, callback),
      ).rejects.toMatchObject({ key: 'team_not_found' })
    const member = await scopeOf(db, U.member, O.harbor)
    await expect(
      inviteMember(
        db,
        member,
        { email: 'noah@example.com', role: 'member', teamId: T.delivery },
        callback,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(called).toBe(false)
  })

  test('Better Auth checks the recipient, verification, expiry, status and invitation role', async () => {
    const created = await invite()
    const wrong = await headers('lead@example.com')
    await expect(
      acceptInvitation(db, U.lead, created.id, () =>
        auth.api.acceptInvitation({ headers: wrong, body: { invitationId: created.id } }),
      ),
    ).rejects.toThrow()
    expect(await memberships(U.loner)).toEqual([])
    const recipient = await headers('noah@example.com')
    await db.update(schema.user).set({ emailVerified: false }).where(eq(schema.user.id, U.loner))
    await expect(
      acceptInvitation(db, U.loner, created.id, () =>
        auth.api.acceptInvitation({ headers: recipient, body: { invitationId: created.id } }),
      ),
    ).rejects.toThrow()
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, U.loner))
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.invitation.id, created.id))
    await expect(
      acceptInvitation(db, U.loner, created.id, () =>
        auth.api.acceptInvitation({ headers: recipient, body: { invitationId: created.id } }),
      ),
    ).rejects.toThrow()
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() + 3600000), status: 'canceled' })
      .where(eq(schema.invitation.id, created.id))
    await expect(
      acceptInvitation(db, U.loner, created.id, () =>
        auth.api.acceptInvitation({ headers: recipient, body: { invitationId: created.id } }),
      ),
    ).rejects.toThrow()
    const admin = await scopeOf(db, U.admin, O.northwind)
    const signedIn = await headers('admin@example.com')
    await expect(
      inviteMember(db, admin, { email: 'guest@example.com', role: 'owner', teamId: T.design }, () =>
        auth.api.createInvitation({
          headers: signedIn,
          body: { email: 'guest@example.com', role: 'owner', organizationId: O.northwind },
        }),
      ),
    ).rejects.toThrow()
    expect(await memberships(U.loner)).toEqual([])
  })

  test('a team deleted during invitation creation leaves an organization-only link', async () => {
    const scope = await scopeOf(db, U.admin, O.harbor)
    const signedIn = await headers('admin@example.com')
    const created = await inviteMember(
      db,
      scope,
      { email: 'noah@example.com', role: 'member', teamId: T.delivery },
      async () => {
        const result = await auth.api.createInvitation({
          headers: signedIn,
          body: { email: 'noah@example.com', role: 'member', organizationId: O.harbor },
        })
        await deleteTeam(db, scope, { teamId: T.delivery })
        return result
      },
    )
    expect((await listInvitations(db, scope)).find((i) => i.id === created.id)?.teamId).toBeNull()
  })
})

describe('member removal hook', () => {
  test('removal stops a timer and clears only this organization’s team memberships, including leads', async () => {
    const admin = await scopeOf(db, U.admin, O.northwind)
    const signedIn = await headers('admin@example.com')
    const own = await as(admin, () => createTeam(db, admin, { name: 'Extra' }))
    await db
      .insert(schema.teamMember)
      .values({ id: uuidv7(), teamId: own.id, userId: U.member, role: 'lead' })
    const [member] = await db
      .select()
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, O.northwind), eq(schema.member.userId, U.member)))
    await auth.api.removeMember({
      headers: signedIn,
      body: { memberIdOrEmail: member.id, organizationId: O.northwind },
    })
    expect(await memberships(U.member)).toEqual([{ teamId: T.delivery, role: 'member' }])
    const running = await db
      .select()
      .from(schema.timeEntry)
      .where(
        and(
          eq(schema.timeEntry.userId, U.member),
          eq(schema.timeEntry.organizationId, O.northwind),
        ),
      )
    expect(running.every((entry) => entry.stoppedAt !== null)).toBe(true)
  })

  test('leaving clears memberships; a rejected removal leaves them alone', async () => {
    const signedIn = await headers('member@example.com')
    await expect(
      auth.api.removeMember({
        headers: signedIn,
        body: { memberIdOrEmail: 'lead@example.com', organizationId: O.northwind },
      }),
    ).rejects.toThrow()
    expect(await memberships(U.lead)).toContainEqual({ teamId: T.design, role: 'lead' })
    await auth.api.leaveOrganization({ headers: signedIn, body: { organizationId: O.northwind } })
    expect(await memberships(U.member)).toEqual([{ teamId: T.delivery, role: 'member' }])
  })
})
