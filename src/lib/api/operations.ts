// The contract's calls by name (task 084): how the JSON API addresses each one, and the
// schemas of what it takes and returns. Both backends serve each one, and the client module
// reaches them through one transport. Only the API's and the host's transports import this
// file, so the TypeScript app's client bundle leaves it out.
import * as v from 'valibot'
import {
  CreateEntryInput,
  DeleteEntryInput,
  Entry,
  GetFirstEntryStartInput,
  ListEntriesInput,
  UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import { type Operation, Timestamp } from '~/server/schemas'
import {
  CreateTeamInput,
  Member,
  RenameTeamInput,
  SetTeamRoleInput,
  Team,
  TeamIdInput,
  TeamMemberInput,
  TeamMembership,
  TeamName,
} from '~/server/teams/teams.schemas'
import { RunningTimer, StartTimerInput, StopTimerInput } from '~/server/timer/timer.schemas'

const organizationPath = '/api/v1/organizations/:organizationId'
const entriesPath = `${organizationPath}/entries`
const teamPath = `${organizationPath}/teams/:teamId`
const teamMemberPath = `${teamPath}/members/:userId`

export const operations = {
  // The running timer spans organizations, so stopping and reading it names no
  // organization.
  getRunningTimer: {
    method: 'GET',
    path: '/api/v1/timer',
    scope: 'user',
    input: undefined,
    output: v.nullable(RunningTimer),
  },
  startTimer: {
    method: 'POST',
    path: '/api/v1/organizations/:organizationId/timer/start',
    scope: 'organization',
    input: StartTimerInput,
    output: v.object({ started: Entry, stopped: v.nullable(Entry) }),
  },
  stopTimer: {
    method: 'POST',
    path: '/api/v1/timer/stop',
    scope: 'user',
    input: StopTimerInput,
    output: Entry,
  },
  listEntries: {
    method: 'GET',
    path: entriesPath,
    scope: 'organization',
    input: ListEntriesInput,
    output: v.array(Entry),
  },
  getFirstEntryStart: {
    method: 'GET',
    path: `${entriesPath}/first-start`,
    scope: 'organization',
    input: GetFirstEntryStartInput,
    output: v.nullable(Timestamp),
  },
  createEntry: {
    method: 'POST',
    path: entriesPath,
    scope: 'organization',
    input: CreateEntryInput,
    output: Entry,
  },
  updateEntry: {
    method: 'PATCH',
    path: `${entriesPath}/:id`,
    scope: 'organization',
    input: UpdateEntryInput,
    output: Entry,
  },
  deleteEntry: {
    method: 'DELETE',
    path: `${entriesPath}/:id`,
    scope: 'organization',
    input: DeleteEntryInput,
    output: v.object({ id: v.string() }),
  },
  listTeams: {
    method: 'GET',
    path: `${organizationPath}/teams`,
    scope: 'organization',
    input: undefined,
    output: v.array(Team),
  },
  createTeam: {
    method: 'POST',
    path: `${organizationPath}/teams`,
    scope: 'organization',
    input: CreateTeamInput,
    output: TeamName,
  },
  renameTeam: {
    method: 'PATCH',
    path: teamPath,
    scope: 'organization',
    input: RenameTeamInput,
    output: TeamName,
  },
  deleteTeam: {
    method: 'DELETE',
    path: teamPath,
    scope: 'organization',
    input: TeamIdInput,
    output: v.object({ id: v.string() }),
  },
  addTeamMember: {
    method: 'PUT',
    path: teamMemberPath,
    scope: 'organization',
    input: TeamMemberInput,
    output: v.object({ teamId: v.string(), userId: v.string() }),
  },
  removeTeamMember: {
    method: 'DELETE',
    path: teamMemberPath,
    scope: 'organization',
    input: TeamMemberInput,
    output: v.object({ teamId: v.string(), userId: v.string() }),
  },
  setTeamRole: {
    method: 'PATCH',
    path: teamMemberPath,
    scope: 'organization',
    input: SetTeamRoleInput,
    output: TeamMembership,
  },
  listMembers: {
    method: 'GET',
    path: `${organizationPath}/members`,
    scope: 'organization',
    input: undefined,
    output: v.array(Member),
  },
} satisfies Record<string, Operation>

type Operations = typeof operations
export type OperationName = keyof Operations

type OwnInput<Schema, None> = Schema extends v.GenericSchema ? v.InferInput<Schema> : None

// What a caller passes: the call's own input, plus the organization it acts in.
export type InputOf<K extends OperationName> = Operations[K]['scope'] extends 'organization'
  ? OwnInput<Operations[K]['input'], unknown> & { organizationId: string }
  : OwnInput<Operations[K]['input'], void>

// The call's input once validated, as the rules take it.
export type ParsedInputOf<K extends OperationName> = Operations[K]['input'] extends v.GenericSchema
  ? v.InferOutput<Operations[K]['input']>
  : undefined

export type OutputOf<K extends OperationName> = v.InferOutput<Operations[K]['output']>
