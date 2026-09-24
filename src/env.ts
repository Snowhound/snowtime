import { createEnv } from '@t3-oss/env-core'
import * as v from 'valibot'

// Server-only environment. Import it from server code only; nothing here may reach the
// browser. Under Bun (`bun --bun run dev`), .env / .env.development / .env.local populate
// process.env; on Vercel the project settings do.
export const env = createEnv({
  server: {
    TURSO_DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
    // Absent locally, where the database is a file.
    TURSO_AUTH_TOKEN: v.optional(v.pipe(v.string(), v.minLength(1))),
    BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(32)),
    BETTER_AUTH_URL: v.pipe(v.string(), v.url()),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
