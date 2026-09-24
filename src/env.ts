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
    // Google sign-in is enabled when both are set (docs/architecture.md, "Sign-in methods").
    GOOGLE_CLIENT_ID: v.optional(secret),
    GOOGLE_CLIENT_SECRET: v.optional(secret),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})

if (!env.GOOGLE_CLIENT_ID !== !env.GOOGLE_CLIENT_SECRET) {
  throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.')
}
