// Each call of the contract run against its rule (task 084), with its input and result as
// JSON. The JSON API runs these for a request (api.server.ts), and the native backend's
// host runs its port of them for the render isolate.
import { APIError } from 'better-auth/api'
import * as v from 'valibot'
import type { Database } from '~/db'
import {
  type OperationName,
  operations,
  type OutputOf,
  type ParsedInputOf,
} from '~/lib/api/operations'
import { decode, type WireError, type WireResponse } from '~/lib/api/wire'
import { auth, rateLimitStore } from './auth/better-auth.server'
import * as invitations from './auth/invitations.server'
import * as entries from './entries/entries.server'
import { AppError, type AppErrorCode } from './errors'
import { rateLimits } from './limits.server'
import * as projects from './projects/projects.server'
import { parseOrganizationInput } from './schemas'
import { resolveScope, type Scope } from './scope.server'
import * as settings from './settings/settings.server'
import * as teams from './teams/teams.server'
import * as timer from './timer/timer.server'

// Who a call runs for: the signed-in user, or null for a public call, and the request's
// headers, which Better Auth's own calls read.
export interface Caller {
  userId: string | null
  headers: Headers
}

type ScopeOf<K extends OperationName> = (typeof operations)[K]['scope']
type Context<K extends OperationName> = {
  db: Database
  headers: Headers
} & (ScopeOf<K> extends 'organization'
  ? { scope: Scope }
  : ScopeOf<K> extends 'user'
    ? { userId: string }
    : unknown)

// Each call's rule.
const handlers: {
  [K in OperationName]: (context: Context<K>, input: ParsedInputOf<K>) => Promise<OutputOf<K>>
} = {
  getRunningTimer: ({ db, userId }) => timer.getRunningTimer(db, userId),
  startTimer: ({ db, scope }, input) => timer.startTimer(db, scope, input),
  stopTimer: ({ db, userId }, input) => timer.stopTimer(db, userId, input),
  createSettings: ({ db, userId }, input) => settings.createSettings(db, userId, input),
  updateSettings: ({ db, userId }, input) => settings.updateSettings(db, userId, input),
  listEntries: ({ db, scope }, input) => entries.listEntries(db, scope, input),
  getFirstEntryStart: ({ db, scope }, input) => entries.getFirstEntryStart(db, scope, input),
  createEntry: ({ db, scope }, input) => entries.createEntry(db, scope, input),
  updateEntry: ({ db, scope }, input) => entries.updateEntry(db, scope, input),
  deleteEntry: ({ db, scope }, input) => entries.deleteEntry(db, scope, input),
  listProjects: ({ db, scope }, input) => projects.listProjects(db, scope, input),
  createProject: ({ db, scope }, input) => projects.createProject(db, scope, input),
  updateProject: ({ db, scope }, input) => projects.updateProject(db, scope, input),
  archiveProject: ({ db, scope }, input) => projects.archiveProject(db, scope, input),
  unarchiveProject: ({ db, scope }, input) => projects.unarchiveProject(db, scope, input),
  deleteProject: ({ db, scope }, input) => projects.deleteProject(db, scope, input),
  assignProjectToTeam: ({ db, scope }, input) => projects.assignProjectToTeam(db, scope, input),
  unassignProjectFromTeam: ({ db, scope }, input) =>
    projects.unassignProjectFromTeam(db, scope, input),
  listInvitations: ({ db, scope }) => invitations.listInvitations(db, scope),
  inviteMember: async ({ db, scope, headers }, input) => {
    const { allowed } = await rateLimitStore.consume(
      `invite:${scope.userId}`,
      rateLimits.inviteMember,
    )
    if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
    const { id, email, expiresAt } = await invitations.inviteMember(db, scope, input, () =>
      auth.api.createInvitation({
        headers,
        body: { email: input.email, role: input.role, organizationId: scope.organizationId },
      }),
    )
    return { id, email, expiresAt }
  },
  getInvitation: ({ db }, input) => invitations.invitationPreview(db, input.id),
  acceptInvitation: ({ db, userId, headers }, input) =>
    invitations.acceptInvitation(db, userId, input.id, () =>
      auth.api.acceptInvitation({ headers, body: { invitationId: input.id } }),
    ),
  listTeams: ({ db, scope }) => teams.listTeams(db, scope),
  createTeam: ({ db, scope }, input) => teams.createTeam(db, scope, input),
  renameTeam: ({ db, scope }, input) => teams.renameTeam(db, scope, input),
  deleteTeam: ({ db, scope }, input) => teams.deleteTeam(db, scope, input),
  addTeamMember: ({ db, scope }, input) => teams.addTeamMember(db, scope, input),
  removeTeamMember: ({ db, scope }, input) => teams.removeTeamMember(db, scope, input),
  setTeamRole: ({ db, scope }, input) => teams.setTeamRole(db, scope, input),
  listMembers: ({ db, scope }) => teams.listMembers(db, scope),
}

const statusOf: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID: 422,
  LIMIT_REACHED: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
}

export function failure(status: number, error: WireError): WireResponse {
  return { status, body: { error } }
}

// A refusal as the contract sends it. Anything else is unexpected and propagates.
export function refusal(error: unknown): WireResponse {
  if (error instanceof AppError) {
    return failure(statusOf[error.code], { code: error.code, key: error.key })
  }
  if (error instanceof v.ValiError) return failure(400, { message: error.message })
  // Better Auth's own refusal, as its HTTP API sends it.
  if (error instanceof APIError) {
    return failure(error.statusCode, { code: error.body?.code, message: error.message })
  }
  throw error
}

// Runs one call, with its input as JSON, after the session check. Like scopeMiddleware, it
// resolves the scope before it validates the call's own input.
export async function runOperation(
  db: Database,
  name: OperationName,
  { userId, headers }: Caller,
  input: unknown,
): Promise<WireResponse> {
  const operation = operations[name]
  try {
    const context =
      operation.scope === 'organization'
        ? {
            db,
            headers,
            scope: await resolveScope(
              db,
              userId!,
              parseOrganizationInput(input as { organizationId: string }).organizationId,
            ),
          }
        : { db, headers, userId }
    const parsed = operation.input ? decode(operation.input, input) : undefined
    const handler = handlers[name] as (context: unknown, input: unknown) => Promise<unknown>
    return { status: 200, body: await handler(context, parsed) }
  } catch (error) {
    return refusal(error)
  }
}
