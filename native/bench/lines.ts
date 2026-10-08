// Counts the code lines of each ported handler and helper in TypeScript and in each Rust
// rules crate: lines that aren't blank or only a comment, from the declaration to its end.
//
//   bun native/bench/lines.ts [rules crate ...]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../perf/lib/database'

// TypeScript [file, names] against Rust [module, names], per row.
const PAIRS: [string, string, string[], string, string[]][] = [
  [
    'Organization leave',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-members.mjs',
    ['leaveOrganization'],
    'auth/writes.rs',
    ['leave'],
  ],
  [
    'Profile update',
    'node_modules/better-auth/dist/api/routes/update-user.mjs',
    ['updateUser'],
    'auth/writes.rs',
    ['rule', 'answer', 'bare', 'empty', 'hook_error'],
  ],
  [
    'Organization set-active',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs',
    ['setActiveOrganization'],
    'auth/writes.rs',
    ['set_active', 'token', 'organization', 'member', 'member_user', 'slug_id'],
  ],
  [
    'Organization check-slug',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs',
    ['checkOrganizationSlug'],
    'auth/writes.rs',
    [],
  ],
  [
    'Organization create',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs',
    ['createOrganization'],
    'auth/writes.rs',
    ['create'],
  ],
  [
    'Organization update',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs',
    ['updateOrganization'],
    'auth/writes.rs',
    ['update'],
  ],
  [
    'Organization member role',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-members.mjs',
    ['updateMemberRole'],
    'auth/writes.rs',
    ['update_role', 'normalized_roles', 'owners', 'role_has', 'admin'],
  ],
  [
    'Organization remove member',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-members.mjs',
    ['removeMember'],
    'auth/writes.rs',
    ['remove'],
  ],
  [
    'Organization cancel invitation',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-invites.mjs',
    ['cancelInvitation'],
    'auth/writes.rs',
    ['cancel', 'org_error'],
  ],
  [
    'Auth write ordered validation',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs',
    [
      'baseOrganizationSchema',
      'checkOrganizationSlugBodySchema',
      'baseUpdateOrganizationSchema',
      'setActiveOrganizationBodySchema',
    ],
    'auth/schemas.rs',
    ['auth_write_issues'],
  ],
  [
    'Auth write name and slug hooks',
    'src/server/auth/name-checks.server.ts',
    ['checkName', 'checkSlug', 'refuse'],
    'auth/writes.rs',
    ['name_error', 'slug_error'],
  ],
  [
    'Member removal timer hook',
    'src/server/timer/timer.server.ts',
    ['stopTimerOfRemovedMember'],
    'auth/writes.rs',
    ['stop_removed_timer'],
  ],
  [
    'Member removal team hook',
    'src/server/teams/teams.server.ts',
    ['removeMemberTeams'],
    'auth/writes.rs',
    ['remove_teams'],
  ],
  [
    'Auth write HTTP policy',
    'src/server/auth/member-removal.server.ts',
    ['memberRemovalHook'],
    'auth/writes.rs',
    ['auth_write'],
  ],
  [
    'Auth write ordered metadata',
    'node_modules/better-auth/dist/plugins/organization/adapter.mjs',
    [],
    'auth/ordered_json.rs',
    ['serialize', 'deserialize', 'get'],
  ],
  [
    'OAuth sign-in and shared authorization',
    'node_modules/better-auth/dist/api/routes/sign-in.mjs',
    ['signInSocial'],
    'auth/oauth.rs',
    ['start', 'authorization_url', 'parameter_pairs'],
  ],
  [
    'OAuth account-link entry',
    'node_modules/better-auth/dist/api/routes/account.mjs',
    ['linkSocialAccount'],
    'auth/oauth.rs',
    [],
  ],
  [
    'OAuth state',
    'node_modules/better-auth/dist/state.mjs',
    ['generateGenericState', 'parseGenericState'],
    'auth/oauth.rs',
    ['consume', 'state_cookie'],
  ],
  [
    'OAuth callback and account writes',
    'node_modules/better-auth/dist/api/routes/callback.mjs',
    ['callbackOAuth'],
    'auth/oauth.rs',
    ['finish', 'save_account', 'scopes'],
  ],
  [
    'OAuth account-link/sign-in helpers',
    'node_modules/better-auth/dist/oauth2/link-account.mjs',
    ['linkOAuthAccount', 'handleOAuthUserInfo'],
    'auth/oauth.rs',
    [],
  ],
  [
    'OAuth token exchange',
    'node_modules/@better-auth/core/dist/oauth2/validate-authorization-code.mjs',
    ['authorizationCodeRequest', 'buildAuthorizationCodeRequest', 'validateAuthorizationCode'],
    'auth/oauth.rs',
    ['exchange', 'client', 'transport_url'],
  ],
  [
    'OAuth Google profile',
    'node_modules/@better-auth/core/dist/social-providers/google.mjs',
    ['google'],
    'auth/oauth.rs',
    ['profile', 'jwt_claims'],
  ],
  [
    'OAuth GitHub profile',
    'node_modules/@better-auth/core/dist/social-providers/github.mjs',
    ['github'],
    'auth/oauth.rs',
    [],
  ],
  [
    'OAuth Microsoft profile',
    'node_modules/@better-auth/core/dist/social-providers/microsoft-entra-id.mjs',
    ['microsoft'],
    'auth/oauth.rs',
    [],
  ],
  [
    'OAuth account list',
    'node_modules/better-auth/dist/api/routes/account.mjs',
    ['listUserAccounts', 'parseStoredScopes'],
    'auth/oauth.rs',
    ['list_accounts'],
  ],
  [
    'OAuth unlink',
    'node_modules/better-auth/dist/api/routes/account.mjs',
    ['unlinkAccount'],
    'auth/oauth.rs',
    ['unlink'],
  ],
  [
    'OAuth ordered Zod validation',
    'node_modules/better-auth/dist/api/routes/sign-in.mjs',
    ['socialSignInBodySchema'],
    'auth/schemas.rs',
    ['oauth_issues', 'oauth_callback_issues'],
  ],
  [
    'OAuth HTTP and redirects',
    'node_modules/better-auth/dist/oauth2/errors.mjs',
    ['redirectOnError'],
    'auth/oauth.rs',
    ['oauth', 'callback_query', 'redirect', 'error', 'session_user'],
  ],
  [
    'passkey registration options',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['generatePasskeyRegistrationOptions'],
    'auth/passkeys.rs',
    ['options', 'descriptors'],
  ],
  [
    'passkey authentication options',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['generatePasskeyAuthenticationOptions'],
    'auth/passkeys.rs',
    [],
  ],
  [
    'passkey registration',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['verifyPasskeyRegistration'],
    'auth/passkeys.rs',
    ['registration', 'check_response'],
  ],
  [
    'passkey authentication',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['verifyPasskeyAuthentication'],
    'auth/passkeys.rs',
    ['authentication', 'new_session', 'auth_user'],
  ],
  [
    'passkey listing',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['listPasskeys'],
    'auth/passkeys.rs',
    ['list_passkeys'],
  ],
  [
    'passkey removal',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['deletePasskey'],
    'auth/passkeys.rs',
    ['delete_passkey'],
  ],
  [
    'passkey Zod validation',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    [
      'generatePasskeyQuerySchema',
      'verifyPasskeyRegistrationBodySchema',
      'verifyPasskeyAuthenticationBodySchema',
    ],
    'auth/schemas.rs',
    ['passkey_issues'],
  ],
  [
    'passkey HTTP and session policy',
    'node_modules/@better-auth/passkey/dist/index.mjs',
    ['resolveRegistrationUser'],
    'auth/passkeys.rs',
    ['passkey', 'run'],
  ],

  [
    'acceptInvitation Zod validation',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-invites.mjs',
    ['acceptInvitationBodySchema'],
    'auth/schemas.rs',
    ['accept_body_issue'],
  ],
  [
    'acceptInvitation app wrapper',
    'src/server/auth/invitations.server.ts',
    ['acceptInvitation'],
    'auth/acceptance.rs',
    ['accept_invitation'],
  ],
  [
    'acceptInvitation Better Auth rule',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-invites.mjs',
    ['acceptInvitation'],
    'auth/acceptance.rs',
    ['accept', 'denied'],
  ],
  [
    'acceptInvitation app hooks',
    'src/server/auth/invitation-acceptance.server.ts',
    ['invitationAcceptanceHooks'],
    'auth/acceptance.rs',
    [],
  ],
  [
    'acceptInvitation HTTP',
    'node_modules/better-auth/dist/plugins/organization/routes/crud-invites.mjs',
    ['acceptInvitationBodySchema'],
    'auth/acceptance.rs',
    ['better_auth_accept_invitation'],
  ],
  [
    'invitationPreview',
    'src/server/auth/invitations.server.ts',
    ['invitationPreview'],
    'auth/invitations.rs',
    ['invitation_preview'],
  ],
  [
    'listInvitations',
    'src/server/auth/invitations.server.ts',
    ['listInvitations'],
    'auth/invitations.rs',
    ['list_invitations'],
  ],
  [
    'inviteMember',
    'src/server/auth/auth.server.ts',
    ['inviteMember'],
    'auth/invitations.rs',
    ['invite_member', 'auth_refusal'],
  ],
  [
    'inviteMember app wrapper',
    'src/server/auth/invitations.server.ts',
    ['inviteMember'],
    'auth/invitations.rs',
    [],
  ],
  [
    'invitationLimit callback',
    'src/server/auth/invitation-limit.server.ts',
    ['invitationLimit'],
    'auth/invitations.rs',
    [],
  ],
  [
    'updateIssueLinks',
    'src/server/auth/organization.server.ts',
    ['updateIssueLinks'],
    'auth/organization.rs',
    ['update_issue_links'],
  ],
  [
    'team write helpers',
    'src/server/teams/teams.server.ts',
    ['assertAdmin', 'assertTeamInScope', 'nameFailure', 'insertTeamMember'],
    'teams/mod.rs',
    ['assert_admin', 'assert_team_in_scope', 'name_failure', 'insert_team_member'],
  ],
  [
    'createTeam',
    'src/server/teams/teams.server.ts',
    ['createTeam'],
    'teams/mod.rs',
    ['create_team'],
  ],
  [
    'renameTeam',
    'src/server/teams/teams.server.ts',
    ['renameTeam'],
    'teams/mod.rs',
    ['rename_team'],
  ],
  [
    'deleteTeam',
    'src/server/teams/teams.server.ts',
    ['deleteTeam'],
    'teams/mod.rs',
    ['delete_team'],
  ],
  [
    'addTeamMember',
    'src/server/teams/teams.server.ts',
    ['addTeamMember'],
    'teams/mod.rs',
    ['add_team_member'],
  ],
  [
    'removeTeamMember',
    'src/server/teams/teams.server.ts',
    ['removeTeamMember'],
    'teams/mod.rs',
    ['remove_team_member'],
  ],
  [
    'setTeamRole',
    'src/server/teams/teams.server.ts',
    ['setTeamRole'],
    'teams/mod.rs',
    ['set_team_role'],
  ],
  [
    'project write helpers',
    'src/server/projects/projects.server.ts',
    ['assertAdmin', 'findProject', 'assertTeamInScope'],
    'projects/mod.rs',
    ['assert_admin', 'project_of', 'find_project', 'assert_team_in_scope'],
  ],
  [
    'createProject',
    'src/server/projects/projects.server.ts',
    ['createProject'],
    'projects/mod.rs',
    ['create_project'],
  ],
  [
    'updateProject',
    'src/server/projects/projects.server.ts',
    ['updateProject'],
    'projects/mod.rs',
    ['update_project'],
  ],
  [
    'archiveProject',
    'src/server/projects/projects.server.ts',
    ['archiveProject', 'setArchived'],
    'projects/mod.rs',
    ['archive_project', 'set_archived'],
  ],
  [
    'unarchiveProject',
    'src/server/projects/projects.server.ts',
    ['unarchiveProject'],
    'projects/mod.rs',
    ['unarchive_project'],
  ],
  [
    'deleteProject',
    'src/server/projects/projects.server.ts',
    ['deleteProject'],
    'projects/mod.rs',
    ['delete_project'],
  ],
  [
    'assignProjectToTeam',
    'src/server/projects/projects.server.ts',
    ['assignProjectToTeam'],
    'projects/mod.rs',
    ['assign_project_to_team'],
  ],
  [
    'unassignProjectFromTeam',
    'src/server/projects/projects.server.ts',
    ['unassignProjectFromTeam'],
    'projects/mod.rs',
    ['unassign_project_from_team'],
  ],
  [
    'createSettings',
    'src/server/settings/settings.server.ts',
    ['createSettings'],
    'settings/mod.rs',
    ['create_settings'],
  ],
  [
    'updateSettings',
    'src/server/settings/settings.server.ts',
    ['updateSettings'],
    'settings/mod.rs',
    ['update_settings'],
  ],
  [
    'signInMethods',
    'src/server/auth/sign-in.server.ts',
    ['signInMethods', 'passwordEnabled', 'socialProviders'],
    'auth/sign_in_page.rs',
    ['sign_in_methods'],
  ],
  [
    'getDeployment',
    'src/server/auth/auth.server.ts',
    ['getDeployment'],
    'auth/sign_in_page.rs',
    ['get_deployment'],
  ],
  [
    'getDevUsers',
    'src/server/auth/auth.server.ts',
    ['getDevUsers'],
    'auth/sign_in_page.rs',
    ['SEED_USERS', 'COMPANY_USERS', 'get_dev_users'],
  ],
  [
    'signOut',
    'node_modules/better-auth/dist/api/routes/sign-out.mjs',
    ['signOut'],
    'auth/sign_out.rs',
    ['sign_out'],
  ],
  [
    'signOut body validation',
    'node_modules/better-auth/dist/api/routes/sign-out.mjs',
    ['signOutBodySchema'],
    'auth/schemas.rs',
    ['sign_out_body_issues'],
  ],
  [
    'signOut URL checks',
    'node_modules/better-auth/dist/api/middlewares/origin-check.mjs',
    ['originCheckMiddleware'],
    'auth/sign_out.rs',
    ['truthy', 'check_urls'],
  ],
  [
    'report context',
    'src/server/reports/reports.server.ts',
    [
      'settingsOf',
      'reportTeams',
      'reportUsers',
      'reportContext',
      'rowWhere',
      'entriesWhere',
      'reportEntries',
      'listedEntries',
      'formerMembers',
      'piecesOf',
      'pagedDays',
    ],
    'reports/mod.rs',
    [
      'settings_of',
      'report_teams',
      'report_users',
      'report_context',
      'row_where',
      'entries_where',
      'filtered_where',
      'report_entries',
      'listed_entry',
      'listed_entries',
      'former_members',
      'pieces_of',
      'paged_days',
    ],
  ],
  [
    'getReport',
    'src/server/reports/reports.server.ts',
    ['getReport', 'reportOf'],
    'reports/mod.rs',
    ['get_report', 'get_report_at'],
  ],
  [
    'getReportBreakdown',
    'src/server/reports/reports.server.ts',
    ['getReportBreakdown'],
    'reports/mod.rs',
    ['get_report_breakdown'],
  ],
  [
    'getReportEntries',
    'src/server/reports/reports.server.ts',
    ['getReportEntries'],
    'reports/mod.rs',
    ['get_report_entries'],
  ],
  [
    'getReportEntryTotals',
    'src/server/reports/reports.server.ts',
    ['getReportEntryTotals'],
    'reports/mod.rs',
    ['get_report_entry_totals'],
  ],
  [
    'getReportExport',
    'src/server/reports/reports.server.ts',
    ['getReportExport'],
    'reports/mod.rs',
    ['get_report_export'],
  ],
  [
    'report aggregation',
    'src/server/reports/aggregation.server.ts',
    [
      'bucketsOf',
      'rangeOf',
      'add',
      'rows',
      'aggregate',
      'byMemberTotal',
      'breakdownOf',
      'placeOf',
      'byDay',
      'dayPage',
      'mergeByDescription',
    ],
    'reports/aggregation.rs',
    [
      'step',
      'buckets',
      'range',
      'rows',
      'or_null',
      'aggregate',
      'breakdown_of',
      'place_of',
      'by_day',
      'day_page',
      'compare_text',
      'merge_by_description',
    ],
  ],
  [
    'scope',
    'src/server/scope.server.ts',
    ['strongestRole', 'resolveScope', 'isAdmin', 'readableUserIds'],
    'scope.rs',
    ['strongest_role', 'resolve_scope', 'is_admin', 'readable_user_ids'],
  ],
  [
    'assertUsableProject',
    'src/server/projects/projects.server.ts',
    ['visibleProjects', 'assertUsableProject'],
    'projects/mod.rs',
    ['VISIBLE_PROJECTS', 'visible_projects', 'assert_usable_project'],
  ],
  [
    'entry columns',
    'src/server/entries/entries.server.ts',
    ['entryColumns'],
    'entries/mod.rs',
    ['ENTRY_COLUMNS', 'entry_of', 'entry_columns'],
  ],
  [
    'entry checks',
    'src/server/entries/entries.server.ts',
    ['assertCanWrite', 'assertMember', 'findEntry', 'assertEntryRoom', 'assertReadable'],
    'entries/mod.rs',
    ['assert_can_write', 'assert_member', 'find_entry', 'assert_entry_room', 'assert_readable'],
  ],
  [
    'createEntry',
    'src/server/entries/entries.server.ts',
    ['createEntry'],
    'entries/mod.rs',
    ['create_entry'],
  ],
  [
    'updateEntry',
    'src/server/entries/entries.server.ts',
    ['updateEntry'],
    'entries/mod.rs',
    ['update_entry'],
  ],
  [
    'deleteEntry',
    'src/server/entries/entries.server.ts',
    ['deleteEntry'],
    'entries/mod.rs',
    ['delete_entry'],
  ],
  [
    'getFirstEntryStart',
    'src/server/entries/entries.server.ts',
    ['getFirstEntryStart'],
    'entries/mod.rs',
    ['get_first_entry_start'],
  ],
  [
    'listEntries',
    'src/server/entries/entries.server.ts',
    ['listEntries'],
    'entries/mod.rs',
    ['list_entries'],
  ],
  [
    'timer helpers',
    'src/server/timer/timer.server.ts',
    ['runningOf', 'isMemberOfEntryOrganization', 'stopAt', 'stopRunning', 'assertStillMember'],
    'timer/mod.rs',
    [
      'RUNNING_OF',
      'IS_MEMBER_OF_ENTRY_ORGANIZATION',
      'STOP_AT',
      'stop_running',
      'assert_still_member',
      'running_of',
      'is_member_of_entry_organization',
      'stop_at',
    ],
  ],
  [
    'listProjects',
    'src/server/projects/projects.server.ts',
    ['projectColumns', 'listProjects'],
    'projects/mod.rs',
    ['PROJECT_COLUMNS', 'list_projects'],
  ],
  [
    'startTimer',
    'src/server/timer/timer.server.ts',
    ['startTimer'],
    'timer/mod.rs',
    ['start_timer'],
  ],
  ['stopTimer', 'src/server/timer/timer.server.ts', ['stopTimer'], 'timer/mod.rs', ['stop_timer']],
  [
    'getRunningTimer',
    'src/server/timer/timer.server.ts',
    ['getRunningTimer'],
    'timer/mod.rs',
    ['get_running_timer'],
  ],
]

function isCode(line: string) {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('//')
}

// The lines of a declaration: from its line until its brackets close and it ends.
function declaration(lines: string[], name: string): string[] | null {
  const start = lines.findIndex((line) =>
    new RegExp(
      `^\\s*(export )?(pub(?:\\([^)]*\\))? )?(async )?(function|fn|const|static) ${name}\\b`,
    ).test(line),
  )
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const char of lines[i].replace(/"(?:\\.|[^"\\])*"|\/\/.*$/g, '')) {
      if ('({['.includes(char)) depth++
      if (')}]'.includes(char)) depth--
    }
    const end = lines[i].trimEnd()
    if (depth === 0 && (end.endsWith('}') || end.endsWith(';') || end.endsWith(')'))) {
      return lines.slice(start, i + 1)
    }
  }
  return lines.slice(start)
}

function count(file: string, names: string[]) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
  return names.reduce(
    (total, name) => total + (declaration(lines, name)?.filter(isCode).length ?? 0),
    0,
  )
}

const crates = process.argv.slice(2)
const rules = crates.length > 0 ? crates : ['server']
const header = ['Handler', 'TypeScript', ...rules]
const rows = PAIRS.map(([label, tsFile, tsNames, module, rustNames]) => [
  label,
  String(count(tsFile, tsNames)),
  ...rules.map((crate) => String(count(`native/crates/${crate}/src/${module}`, rustNames))),
])
const totals = header
  .slice(1)
  .map((_, column) => String(rows.reduce((total, row) => total + Number(row[column + 1]), 0)))
console.log(`| ${header.join(' | ')} |`)
console.log(`| ${header.map(() => '---').join(' | ')} |`)
for (const row of [...rows, ['Total', ...totals]]) console.log(`| ${row.join(' | ')} |`)
