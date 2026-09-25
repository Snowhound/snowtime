import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start/solid'
import { v7 as uuidv7 } from 'uuid'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import * as schema from '~/db/schema'
import { env } from '~/env'
import { limits } from '../limits.server'
import { stopTimerOfRemovedMember } from '../timer/timer.server'
import { passwordEnabled, socialProviders } from './sign-in.server'

// Passkeys are bound to the app's domain, so each environment's relying party follows its
// BETTER_AUTH_URL; the plugin would otherwise default to localhost.
const appUrl = new URL(env.BETTER_AUTH_URL)

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  advanced: {
    database: { generateId: () => uuidv7() },
  },
  // The session and user ride in a signed cookie for 5 minutes, so a server function call
  // doesn't read them from the database. A session revoked elsewhere, or a deleted account,
  // stays usable that long on a device that has the cookie (docs/architecture.md, "Sign-in
  // methods"). Membership is still read on every call (resolveScope).
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  // Password sign-in is for local development with seeded users only: the MVP sends no
  // email, so there is no verification or reset (docs/architecture.md, "Sign-in methods").
  emailAndPassword: {
    enabled: passwordEnabled(env),
  },
  socialProviders: socialProviders(env),
  hooks: {
    // A member removed from an organization, or leaving it, loses access to its entries, so
    // their running timer there stops now (docs/architecture.md, "Tenancy"). The plugin's
    // afterRemoveMember hook misses /organization/leave, so this hook watches both.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/organization/remove-member' && ctx.path !== '/organization/leave') return
      const returned = ctx.context.returned
      if (typeof returned !== 'object' || !returned || returned instanceof APIError) return
      // remove-member returns { member }, leave returns the member itself.
      const removed = ('member' in returned ? returned.member : returned) as {
        userId: string
        organizationId: string
      }
      const actor = ctx.context.session?.user.id ?? removed.userId
      await withActor(actor, () =>
        stopTimerOfRemovedMember(db, removed.userId, removed.organizationId),
      )
    }),
  },
  plugins: [
    organization({
      teams: {
        enabled: true,
        // Teams are optional in Snowtime; an organization starts without one, and admins
        // may delete its last one.
        defaultTeam: { enabled: false },
        allowRemovingAllTeams: true,
        maximumTeams: limits.teamsPerOrganization,
      },
      organizationLimit: limits.organizationsPerUser,
      membershipLimit: limits.membersPerOrganization,
      invitationLimit: limits.pendingInvitationsPerOrganization,
      // Admins share invitation links themselves; a link works for 48 hours
      // (docs/architecture.md, "Sign-in methods").
      invitationExpiresIn: 48 * 60 * 60,
      // Organizations own time entries and are never hard-deleted (docs/architecture.md).
      disableOrganizationDeletion: true,
    }),
    passkey({ rpID: appUrl.hostname, rpName: 'Snowtime', origin: appUrl.origin }),
    // Must stay last: it sets cookies from the other plugins' responses.
    tanstackStartCookies(),
  ],
})
