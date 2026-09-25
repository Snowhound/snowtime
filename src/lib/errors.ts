import { m } from '~/paraglide/messages.js'
import { AppError, type AppErrorKey } from '~/server/errors'

// One message per AppError key. Typed as a full record, so a key added to the catalog in
// src/server/errors.ts fails the type check until it has a message here.
const errorText: Record<AppErrorKey, () => string> = {
  sign_in_required: m.error_sign_in_required,
  organization_required: m.error_organization_required,
  not_organization_member: m.error_not_organization_member,
  organization_changed: m.error_organization_changed,
  member_not_found: m.error_member_not_found,
  team_not_found: m.error_team_not_found,
  team_member_not_found: m.error_team_member_not_found,
  teams_forbidden: m.error_teams_forbidden,
  entry_not_found: m.error_entry_not_found,
  entry_id_taken: m.error_entry_id_taken,
  entry_forbidden: m.error_entry_forbidden,
  entries_forbidden: m.error_entries_forbidden,
  entry_running: m.error_entry_running,
  entry_end_before_start: m.error_entry_end_before_start,
  entry_too_long: m.error_entry_too_long,
  entry_limit: m.error_entry_limit,
  timer_not_running: m.error_timer_not_running,
  timer_started_elsewhere: m.error_timer_started_elsewhere,
  timer_running_in_left_organization: m.error_timer_running_in_left_organization,
  project_not_found: m.error_project_not_found,
  project_id_taken: m.error_project_id_taken,
  project_name_taken: m.error_project_name_taken,
  project_archived: m.error_project_archived,
  project_has_entries: m.error_project_has_entries,
  project_limit: m.error_project_limit,
  projects_forbidden: m.error_projects_forbidden,
  team_report_forbidden: m.error_team_report_forbidden,
  settings_not_found: m.error_settings_not_found,
  rate_limited: m.error_rate_limited,
}

// Refusals from Better Auth's client calls, by the code its error carries (unwrap in
// src/lib/auth-client.ts throws it). The organization plugin checks roles, owners and
// invitations itself (docs/architecture.md, "Tenancy"); these are the refusals the
// Organization view, creating an organization, and accepting an invitation can meet.
const authErrorText: Record<string, () => string> = {
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: m.error_last_owner,
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: m.error_last_owner,
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: m.error_member_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: m.error_member_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: m.error_invite_role_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: m.error_organization_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: m.error_organization_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: m.error_organization_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION: m.error_teams_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM: m.error_teams_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION: m.error_teams_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM: m.error_teams_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER: m.error_teams_forbidden,
  YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER: m.error_teams_forbidden,
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: m.error_already_member,
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: m.error_already_invited,
  INVITATION_LIMIT_REACHED: m.error_invitation_limit,
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: m.error_member_limit,
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS: m.error_team_limit,
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS: m.error_organization_limit,
  INVALID_EMAIL: m.error_invalid_email,
  MEMBER_NOT_FOUND: m.error_member_not_found,
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: m.error_member_not_found,
  TEAM_NOT_FOUND: m.error_team_not_found,
  USER_IS_NOT_A_MEMBER_OF_THE_TEAM: m.error_team_member_not_found,
  INVITATION_NOT_FOUND: m.error_invitation_not_found,
}

function authErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

// The text to show for an error from a server function or a Better Auth client call. An
// AppError from a newer server than this client falls back to the server's English
// message; anything else is unexpected and gets a generic message instead of internals.
export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return errorText[error.key]?.() ?? error.message
  // Better Auth's rate limiter answers 429 without a code.
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 429) {
    return m.error_rate_limited()
  }
  const code = authErrorCode(error)
  return (code && authErrorText[code]?.()) || m.error_unexpected()
}
