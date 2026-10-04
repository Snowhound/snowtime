// The contract's calls by name (task 084): how the JSON API addresses each one, and the
// schemas of what it takes and returns. Both backends serve each one, and the client module
// reaches them through one transport, which uses the schemas to decode the answers.
import * as v from 'valibot'
import {
  ApiKey,
  AppSession,
  CreateApiKeyInput,
  CreatedApiKey,
  CreatedInvitation,
  Deployment,
  DevUser,
  GetInvitationInput,
  Invitation,
  InvitationPreview,
  InviteMemberInput,
  Me,
  RevokeApiKeyInput,
  SignInMethod,
  UpdateIssueLinksInput,
} from '~/server/auth/auth.schemas'
import {
  CreateEntryInput,
  DeleteEntryInput,
  Entry,
  GetFirstEntryStartInput,
  ListEntriesInput,
  UpdateEntryInput,
} from '~/server/entries/entries.schemas'
import {
  CreateProjectInput,
  ListedProject,
  ListProjectsInput,
  Project,
  ProjectIdInput,
  ProjectTeamInput,
  UpdateProjectInput,
} from '~/server/projects/projects.schemas'
import {
  Report,
  ReportBreakdown,
  ReportEntries,
  ReportEntriesInput,
  ReportEntryTotals,
  ReportEntryTotalsInput,
  ReportExport,
  ReportExportInput,
  ReportInput,
} from '~/server/reports/reports.schemas'
import { type Operation, Timestamp } from '~/server/schemas'
import {
  CreateSettingsInput,
  Settings,
  UpdateSettingsInput,
} from '~/server/settings/settings.schemas'
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
const reportPath = `${organizationPath}/report`
const projectPath = `${organizationPath}/projects/:id`
const projectTeamPath = `${organizationPath}/projects/:projectId/teams/:teamId`
const teamPath = `${organizationPath}/teams/:teamId`
const teamMemberPath = `${teamPath}/members/:userId`

export const operations = {
  // The signed-in user, their organizations and settings, or null when signed out.
  getAppSession: {
    method: 'GET',
    path: '/api/v1/session',
    scope: 'public',
    input: undefined,
    output: v.nullable(AppSession),
  },
  getSignInMethods: {
    method: 'GET',
    path: '/api/v1/sign-in-methods',
    scope: 'public',
    input: undefined,
    output: v.array(SignInMethod),
  },
  getDeployment: {
    method: 'GET',
    path: '/api/v1/deployment',
    scope: 'public',
    input: undefined,
    output: Deployment,
  },
  // Whether the app can serve pages, which the maintenance page polls during an outage. It
  // reads no session, since the database may be down.
  checkAvailability: {
    method: 'GET',
    path: '/api/v1/availability',
    scope: 'public',
    input: undefined,
    output: v.boolean(),
  },
  // Empty wherever password sign-in is off.
  getDevUsers: {
    method: 'GET',
    path: '/api/v1/dev-users',
    scope: 'public',
    input: undefined,
    output: v.array(DevUser),
  },
  // The session read for a client that signs in with an API key.
  getMe: {
    method: 'GET',
    path: '/api/v1/me',
    scope: 'user',
    apiKeys: true,
    input: undefined,
    output: Me,
  },
  // The signed-in user's API keys, for Settings. A key can't manage keys.
  listApiKeys: {
    method: 'GET',
    path: '/api/v1/api-keys',
    scope: 'user',
    input: undefined,
    output: v.array(ApiKey),
  },
  createApiKey: {
    method: 'POST',
    path: '/api/v1/api-keys',
    scope: 'user',
    input: CreateApiKeyInput,
    output: CreatedApiKey,
  },
  revokeApiKey: {
    method: 'DELETE',
    path: '/api/v1/api-keys/:id',
    scope: 'user',
    input: RevokeApiKeyInput,
    output: v.object({ id: v.string() }),
  },
  // Better Auth's organization client can't set the app's own columns.
  updateIssueLinks: {
    method: 'PATCH',
    path: `${organizationPath}/issue-links`,
    scope: 'organization',
    input: UpdateIssueLinksInput,
    output: v.object({ id: v.string(), issueLinks: v.nullable(v.string()) }),
  },
  // The running timer spans organizations, so stopping and reading it names no
  // organization.
  getRunningTimer: {
    method: 'GET',
    path: '/api/v1/timer',
    scope: 'user',
    apiKeys: true,
    input: undefined,
    output: v.nullable(RunningTimer),
  },
  startTimer: {
    method: 'POST',
    path: '/api/v1/organizations/:organizationId/timer/start',
    scope: 'organization',
    apiKeys: true,
    input: StartTimerInput,
    output: v.object({ started: Entry, stopped: v.nullable(Entry) }),
  },
  stopTimer: {
    method: 'POST',
    path: '/api/v1/timer/stop',
    scope: 'user',
    apiKeys: true,
    input: StopTimerInput,
    output: Entry,
  },
  // Settings are per user, so they name no organization. A new user's are created by an
  // explicit write, so the session read stays a read.
  createSettings: {
    method: 'PUT',
    path: '/api/v1/settings',
    scope: 'user',
    input: CreateSettingsInput,
    output: Settings,
  },
  updateSettings: {
    method: 'PATCH',
    path: '/api/v1/settings',
    scope: 'user',
    input: UpdateSettingsInput,
    output: Settings,
  },
  listEntries: {
    method: 'GET',
    path: entriesPath,
    scope: 'organization',
    apiKeys: true,
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
  listProjects: {
    method: 'GET',
    path: `${organizationPath}/projects`,
    scope: 'organization',
    apiKeys: true,
    input: ListProjectsInput,
    output: v.array(ListedProject),
  },
  createProject: {
    method: 'POST',
    path: `${organizationPath}/projects`,
    scope: 'organization',
    input: CreateProjectInput,
    output: Project,
  },
  updateProject: {
    method: 'PATCH',
    path: projectPath,
    scope: 'organization',
    input: UpdateProjectInput,
    output: Project,
  },
  archiveProject: {
    method: 'POST',
    path: `${projectPath}/archive`,
    scope: 'organization',
    input: ProjectIdInput,
    output: Project,
  },
  unarchiveProject: {
    method: 'POST',
    path: `${projectPath}/unarchive`,
    scope: 'organization',
    input: ProjectIdInput,
    output: Project,
  },
  deleteProject: {
    method: 'DELETE',
    path: projectPath,
    scope: 'organization',
    input: ProjectIdInput,
    output: v.object({ id: v.string() }),
  },
  assignProjectToTeam: {
    method: 'PUT',
    path: projectTeamPath,
    scope: 'organization',
    input: ProjectTeamInput,
    output: v.object({ projectId: v.string(), teamId: v.string() }),
  },
  unassignProjectFromTeam: {
    method: 'DELETE',
    path: projectTeamPath,
    scope: 'organization',
    input: ProjectTeamInput,
    output: v.object({ projectId: v.string(), teamId: v.string() }),
  },
  getReport: {
    method: 'POST',
    read: true,
    path: reportPath,
    scope: 'organization',
    input: ReportInput,
    output: Report,
  },
  // Breakdown's second level: time per project and member and per ticket and member.
  getReportBreakdown: {
    method: 'POST',
    read: true,
    path: `${reportPath}/breakdown`,
    scope: 'organization',
    input: ReportInput,
    output: ReportBreakdown,
  },
  // The Entries card's list: By description's merged rows, or one page of By day.
  getReportEntries: {
    method: 'POST',
    read: true,
    path: `${reportPath}/entries`,
    scope: 'organization',
    input: ReportEntriesInput,
    output: ReportEntries,
  },
  // The Entries card's count and total for one part of the timesheet.
  getReportEntryTotals: {
    method: 'POST',
    read: true,
    path: `${reportPath}/entry-totals`,
    scope: 'organization',
    input: ReportEntryTotalsInput,
    output: ReportEntryTotals,
  },
  // One month or less of the export's entries; the first piece brings the report as well.
  getReportExport: {
    method: 'POST',
    read: true,
    path: `${reportPath}/export`,
    scope: 'organization',
    input: ReportExportInput,
    output: ReportExport,
  },
  listInvitations: {
    method: 'GET',
    path: `${organizationPath}/invitations`,
    scope: 'organization',
    input: undefined,
    output: v.array(Invitation),
  },
  inviteMember: {
    method: 'POST',
    path: `${organizationPath}/invitations`,
    scope: 'organization',
    input: InviteMemberInput,
    output: CreatedInvitation,
  },
  // An invitation link's details, which anyone with the link may see before signing in.
  getInvitation: {
    method: 'GET',
    path: '/api/v1/invitations/:id',
    scope: 'public',
    input: GetInvitationInput,
    output: InvitationPreview,
  },
  acceptInvitation: {
    method: 'POST',
    path: '/api/v1/invitations/:id/accept',
    scope: 'user',
    input: GetInvitationInput,
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
