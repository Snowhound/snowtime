import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start/solid'
import { v7 as uuidv7 } from 'uuid'
import { db } from '~/db'
import * as schema from '~/db/schema'
import { appUrl as appUrlString, env, trustedOrigins } from '~/env'
import { limits, rateLimits } from '../limits.server'
import { createRateLimitStore } from '../rate-limit.server'
import { time } from '../timing.server'
import { invitationLimit } from './invitation-limit.server'
import {
  loginDomainHooks,
  loginDomainMiddleware,
  loginDomainSessionAllowed,
} from './login-policy.server'
import { memberRemovalHook } from './member-removal.server'
import { databaseHooks, organizationHooks } from './name-checks.server'
import { passwordEnabled, refuseUnverifiedSignUp, socialProviders } from './sign-in.server'

// Passkeys are bound to the app's domain, so each environment's relying party follows its
// URL; the plugin would otherwise default to localhost.
const appUrl = new URL(appUrlString)
const domains = env.ALLOWED_LOGIN_DOMAINS ?? []
const removalHook = memberRemovalHook(db)
const domainHooks = loginDomainHooks(domains, (id) =>
  db.query.user.findFirst({ columns: { email: true }, where: { id } }),
)

// Shared with the API's session check, which limits each user's writes with it.
export const rateLimitStore = createRateLimitStore(env)

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: appUrlString,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  advanced: {
    database: { generateId: () => uuidv7() },
    // Without a trustworthy address, every request shares one rate-limit count.
    ...(env.CLIENT_IP_HEADER && { ipAddress: { ipAddressHeaders: [env.CLIENT_IP_HEADER] } }),
  },
  // The session and user ride in a signed cookie for 5 minutes, so an API call
  // doesn't read them from the database. A session revoked elsewhere, or a deleted account,
  // stays usable that long on a device that has the cookie (docs/architecture/auth.md, "Sign-in
  // methods"). Membership is still read on every call (resolveScope). A session lasts 30 days
  // and is renewed daily while used, so someone who tracks time often stays signed in.
  session: { expiresIn: 30 * 24 * 60 * 60, cookieCache: { enabled: true, maxAge: 5 * 60 } },
  // On in production only, per IP address and path. The counts go where the API's
  // go: Upstash Redis when configured, else memory (docs/architecture/auth.md,
  // "Abuse limits").
  rateLimit: {
    customStorage: rateLimitStore,
    customRules: {
      '/organization/create': rateLimits.createOrganization,
      '/organization/invite-member': rateLimits.inviteMember,
    },
  },
  // Password sign-in is for local development and demo deployments with seeded users: the MVP sends no
  // email, so there is no verification or reset (docs/architecture/auth.md, "Sign-in methods").
  emailAndPassword: {
    enabled: passwordEnabled(env),
    disableSignUp: env.DEMO_MODE,
  },
  socialProviders: socialProviders(env),
  databaseHooks: {
    user: {
      ...databaseHooks.user,
      create: {
        before: async (user, ctx) => {
          await domainHooks.user.create.before(user)
          await refuseUnverifiedSignUp(user, ctx)
        },
      },
      update: {
        before: async (user) => {
          await domainHooks.user.update.before(user)
          await databaseHooks.user.update.before(user)
        },
      },
    },
    session: domainHooks.session,
  },
  hooks: {
    before: loginDomainMiddleware(domains),
    // A member removed from an organization, or leaving it, loses access to its entries, so
    // their running timer there stops now (docs/architecture/data.md, "Tenancy"). The plugin's
    // afterRemoveMember hook misses /organization/leave, so this hook watches both.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/get-session' && !loginDomainSessionAllowed(domains, ctx.context.returned))
        return ctx.json(null)
      await removalHook(ctx)
      return undefined
    }),
  },
  plugins: [
    organization({
      organizationLimit: limits.organizationsPerUser,
      membershipLimit: limits.membersPerOrganization,
      invitationLimit: invitationLimit(db),
      // Admins share invitation links themselves; a link works for 48 hours
      // (docs/architecture/auth.md, "Sign-in methods").
      invitationExpiresIn: 48 * 60 * 60,
      // Only a verified address accepts or rejects an invitation to it. Better Auth turns
      // this on by itself only because generateId isn't its default, so it stays explicit.
      requireEmailVerificationOnInvitation: true,
      // Organizations own time entries and are never hard-deleted (docs/architecture/data.md).
      disableOrganizationDeletion: true,
      organizationHooks,
    }),
    passkey({ rpID: appUrl.hostname, rpName: 'Snowtime', origin: appUrl.origin }),
    // Must stay last: it sets cookies from the other plugins' responses.
    tanstackStartCookies(),
  ],
})

// The request's session, if it has one, timed for Server-Timing.
export function sessionOf(headers: Headers) {
  return time('session', () => auth.api.getSession({ headers }))
}
