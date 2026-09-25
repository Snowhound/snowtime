import { createEnv } from '@t3-oss/env-core'
import * as v from 'valibot'

const secret = v.pipe(v.string(), v.minLength(1))

// Server-only environment. Import it from server code only; nothing here may reach the
// browser. Under Bun (`bun --bun run dev`), .env / .env.development / .env.local populate
// process.env; on Vercel the project settings do.
export const env = createEnv({
  server: {
    // Vite sets development for `dev`; anything unset counts as production, so
    // development-only features stay off unless explicitly on.
    NODE_ENV: v.optional(v.picklist(['development', 'test', 'production']), 'production'),
    TURSO_DATABASE_URL: secret,
    // Absent locally, where the database is a file.
    TURSO_AUTH_TOKEN: v.optional(secret),
    BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(32)),
    BETTER_AUTH_URL: v.pipe(v.string(), v.url()),
    // Each OAuth provider is enabled when both its client ID and secret are set
    // (docs/architecture.md, "Sign-in methods").
    GOOGLE_CLIENT_ID: v.optional(secret),
    GOOGLE_CLIENT_SECRET: v.optional(secret),
    GITHUB_CLIENT_ID: v.optional(secret),
    GITHUB_CLIENT_SECRET: v.optional(secret),
    MICROSOFT_CLIENT_ID: v.optional(secret),
    MICROSOFT_CLIENT_SECRET: v.optional(secret),
    // Restricts Microsoft sign-in to one Entra ID tenant; unset allows any account.
    MICROSOFT_TENANT_ID: v.optional(secret),
    // Upstash Redis for rate-limit counts shared by every function instance; unset keeps
    // them in memory (docs/architecture.md, "Abuse limits").
    UPSTASH_REDIS_REST_URL: v.optional(v.pipe(v.string(), v.url())),
    UPSTASH_REDIS_REST_TOKEN: v.optional(secret),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})

for (const provider of ['GOOGLE', 'GITHUB', 'MICROSOFT'] as const) {
  const id = `${provider}_CLIENT_ID` as const
  const clientSecret = `${provider}_CLIENT_SECRET` as const
  if (!env[id] !== !env[clientSecret]) {
    throw new Error(`Set both ${id} and ${clientSecret}, or neither.`)
  }
}

if (!env.UPSTASH_REDIS_REST_URL !== !env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error('Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.')
}

if (env.MICROSOFT_TENANT_ID && !env.MICROSOFT_CLIENT_ID) {
  throw new Error('MICROSOFT_TENANT_ID needs MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.')
}
