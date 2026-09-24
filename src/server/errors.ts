// Errors server functions throw on purpose. The code tells the client what went wrong
// without it parsing messages; the key names the message, so the client can show it in
// the user's language. This file reaches the client through src/start.ts: no server
// imports.
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_ACTIVE_ORGANIZATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Input that passed the schema but not a rule that needs the database, e.g. an update
  // that would end an entry before it starts.
  | 'INVALID'

// Every message an AppError can carry, by key. Keys are stable and snake_case, so they
// can serve as Paraglide message ids (task 012); the English text is the fallback.
export const errorMessages = {
  sign_in_required: 'Sign in first.',
  organization_required: 'Select an organization first.',
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
  timer_not_running: 'This timer is not running.',
  timer_started_elsewhere: 'Another timer was started at the same time.',
  project_not_found: 'Project not found.',
  project_id_taken: 'A project with this id already exists.',
  project_name_taken: 'A project with this name already exists.',
  project_archived: 'The project is archived.',
  projects_forbidden: 'Only admins can manage projects.',
  settings_not_found: 'Load the settings first.',
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
