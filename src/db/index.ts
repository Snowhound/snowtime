// Server-only database client. Import it from server functions and server code only; the
// Turso token must never reach the browser.
import { drizzle } from 'drizzle-orm/libsql'
import { env } from '../env'
import { relations } from './relations'

export const db = drizzle({
  connection: { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN },
  relations,
})

export type Database = typeof db
