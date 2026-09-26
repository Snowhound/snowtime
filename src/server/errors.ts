// Errors server functions throw on purpose. The code tells the client what went wrong
// without it parsing messages; the key names the message, so the client can show it in
// the user's language. This file reaches the client through src/start.ts: no server
// imports.
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Input that passed the schema but not a rule that needs the database, e.g. an update
  // that would end an entry before it starts.
  | 'INVALID'
  // A cap in src/server/limits.server.ts.
  | 'LIMIT_REACHED'
  // A rate in rateLimits (src/server/limits.server.ts).
  | 'RATE_LIMITED'

// Every message an AppError can carry, by key. Keys are stable and snake_case, so they
// name the Paraglide message error_<key> (src/lib/errors.ts); the English text is the fallback.
export const errorMessages = {
  sign_in_required: 'Sign in first.',
  not_organization_member: 'You are not a member of this organization.',
  member_not_found: 'Member not found.',
  team_not_found: 'Team not found.',
  team_member_not_found: 'This member is not on the team.',
  teams_forbidden: 'Only admins can manage teams.',
  entry_not_found: 'Entry not found.',
  entry_id_taken: 'An entry with this id already exists.',
  entry_forbidden: "Only admins can change other members' entries.",
  entries_forbidden: "You cannot see this member's entries.",
  entry_running: 'Stop a running entry with the timer.',
  entry_end_before_start: 'The end must be after the start.',
  entry_too_long: 'An entry can be at most 24 hours long.',
  entry_limit: 'You have too many entries around this time. Delete some first.',
  timer_not_running: 'This timer is not running.',
  timer_started_elsewhere: 'Another timer was started at the same time.',
  timer_running_in_left_organization:
    'Your timer is still running in an organization you left. Ask an admin there to delete it.',
  project_not_found: 'Project not found.',
  project_id_taken: 'A project with this id already exists.',
  project_name_taken: 'A project with this name already exists.',
  project_archived: 'The project is archived.',
  project_has_entries: 'This project has time entries. Archive it instead.',
  project_limit: 'This organization has too many projects. Delete unused ones first.',
  projects_forbidden: 'Only admins can manage projects.',
  team_report_forbidden: 'You can report only on teams you lead.',
  settings_not_found: 'Load the settings first.',
  rate_limited: 'Too many changes in a short time. Wait a minute and try again.',
} as const

export type AppErrorKey = keyof typeof errorMessages

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly key: AppErrorKey,
  ) {
    // A client built before a key existed still gets a message after a deploy.
    super(errorMessages[key] ?? key)
    this.name = 'AppError'
  }
}
