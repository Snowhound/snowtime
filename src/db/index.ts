// Server-only database client. Import it from server functions and server code only; the
// Turso token must never reach the browser.
import { drizzle } from 'drizzle-orm/libsql'
import { relations } from './relations'

const url = process.env.TURSO_DATABASE_URL
if (!url) throw new Error('TURSO_DATABASE_URL is not set.')

export const db = drizzle({
  connection: { url, authToken: process.env.TURSO_AUTH_TOKEN },
  relations,
})

export type Database = typeof db
