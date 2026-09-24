import { defineConfig } from 'drizzle-kit'

// Reads only the database variables, never the full runtime env schema. The db:* scripts
// run under Bun, so .env / .env.development / .env.local populate process.env here.
const url = process.env.TURSO_DATABASE_URL
if (!url) {
  throw new Error('TURSO_DATABASE_URL is not set. Locally it comes from .env.development.')
}

// Migrations are hand-written SQL and are the source of truth; see docs/migrations.md.
// schema.ts is maintained by hand to match and is only diffed against, never generated from.
export default defineConfig({
  dialect: 'turso',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
