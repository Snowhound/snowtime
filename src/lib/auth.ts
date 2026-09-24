import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { v7 as uuidv7 } from 'uuid'
import { db } from '../db'
import * as schema from '../db/schema'
import { env } from '../env'

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  advanced: {
    database: { generateId: () => uuidv7() },
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      teams: {
        enabled: true,
        // Teams are optional in Snowtime; an organization starts without one.
        defaultTeam: { enabled: false },
      },
      // Organizations own time entries and are never hard-deleted (docs/architecture.md).
      disableOrganizationDeletion: true,
    }),
    // Must stay last: it sets cookies from the other plugins' responses.
    tanstackStartCookies(),
  ],
})
