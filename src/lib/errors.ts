import { m } from '../paraglide/messages.js'
import { AppError, type AppErrorKey } from '../server/errors'

// One message per AppError key. Typed as a full record, so a key added to the catalog in
// src/server/errors.ts fails the type check until it has a message here.
const errorText: Record<AppErrorKey, () => string> = {
  sign_in_required: m.error_sign_in_required,
  organization_required: m.error_organization_required,
  not_organization_member: m.error_not_organization_member,
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
  timer_not_running: m.error_timer_not_running,
  timer_started_elsewhere: m.error_timer_started_elsewhere,
  project_not_found: m.error_project_not_found,
  project_id_taken: m.error_project_id_taken,
  project_name_taken: m.error_project_name_taken,
  project_archived: m.error_project_archived,
  project_has_entries: m.error_project_has_entries,
  projects_forbidden: m.error_projects_forbidden,
  team_report_forbidden: m.error_team_report_forbidden,
  settings_not_found: m.error_settings_not_found,
}

// The text to show for an error from a server function. An AppError from a newer server
// than this client falls back to the server's English message; anything else is
// unexpected and gets a generic message instead of internals.
export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return errorText[error.key]?.() ?? error.message
  return m.error_unexpected()
}
