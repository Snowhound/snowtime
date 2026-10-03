// The /api/v1 endpoints (docs/api.md). Each calls an existing rule and answers named
// fields, so a column added to a table doesn't reach the contract by accident. Lists sit
// under a key, so a field such as a page cursor can be added beside them.
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import type { Database } from '~/db'
import { user } from '~/db/schema'
import { organizationsOf } from '../auth/session.server'
import { ListEntriesInput } from '../entries/entries.schemas'
import * as entries from '../entries/entries.server'
import * as projects from '../projects/projects.server'
import { StartTimerInput } from '../timer/timer.schemas'
import * as timer from '../timer/timer.server'
import type { createApiRoute } from './api.server'

type ApiRoute = ReturnType<typeof createApiRoute>

type Entry = {
  id: string
  organizationId: string
  userId: string
  projectId: string | null
  description: string
  ticket: string | null
  startedAt: Date
  stoppedAt: Date | null
}

// Response.json writes a Date as an ISO 8601 string in UTC.
function entryJson(entry: Entry) {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    userId: entry.userId,
    projectId: entry.projectId,
    description: entry.description,
    ticket: entry.ticket,
    startedAt: entry.startedAt,
    stoppedAt: entry.stoppedAt,
  }
}

// A query string holds text, so the range arrives as ISO 8601 strings and becomes the
// dates ListEntriesInput checks.
const IsoTimestamp = v.pipe(
  v.string(),
  v.isoTimestamp('from and to must be ISO 8601 timestamps.'),
  v.transform((value) => new Date(value)),
)
const ListEntriesQuery = v.pipe(
  v.object({ from: IsoTimestamp, to: IsoTimestamp, userId: v.optional(v.string()) }),
  ListEntriesInput,
)

export function createEndpoints(apiRoute: ApiRoute, db: Database) {
  return {
    // Not appSession: it also reads settings and fill totals the API doesn't answer.
    me: apiRoute({ access: 'read' }, async ({ userId }) => {
      const [[account], organizations] = await Promise.all([
        db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, userId)),
        organizationsOf(db, userId),
      ])
      return {
        user: account,
        organizations: organizations.map(({ id, name, slug, role }) => ({ id, name, slug, role })),
      }
    }),

    runningTimer: apiRoute({ access: 'read' }, async ({ userId }) => {
      const running = await timer.getRunningTimer(db, userId)
      return {
        timer: running && {
          ...entryJson(running),
          project: running.project && {
            id: running.project.id,
            name: running.project.name,
            color: running.project.color,
          },
        },
      }
    }),

    startTimer: apiRoute(
      { access: 'write', organization: true, input: StartTimerInput },
      async ({ scope, input }) => {
        const { started, stopped } = await timer.startTimer(db, scope, input)
        return { started: entryJson(started), stopped: stopped && entryJson(stopped) }
      },
    ),

    // Names the entry, so a retried or late stop leaves a timer started since running.
    stopTimer: apiRoute({ access: 'write' }, async ({ userId, params }) => {
      const stopped = await timer.stopTimer(db, userId, { id: params.entryId })
      return { stopped: entryJson(stopped) }
    }),

    projects: apiRoute({ access: 'read', organization: true }, async ({ scope }) => {
      const rows = await projects.listProjects(db, scope, { includeArchived: false })
      return { projects: rows.map(({ id, name, color }) => ({ id, name, color })) }
    }),

    entries: apiRoute(
      { access: 'read', organization: true, input: ListEntriesQuery },
      async ({ scope, input }) => {
        const rows = await entries.listEntries(db, scope, input)
        return { entries: rows.map(entryJson) }
      },
    ),
  }
}
