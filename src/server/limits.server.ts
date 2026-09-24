// Caps that keep one account from growing the database without bound (docs/architecture.md,
// "Abuse limits"). Each sits far above honest use: reaching one means a script, not a team.
export const limits = {
  // The organization plugin counts every organization the user belongs to, invited ones
  // included, when the user creates another.
  organizationsPerUser: 10,
  membersPerOrganization: 500,
  pendingInvitationsPerOrganization: 100,
  teamsPerOrganization: 100,
  // Archived projects count; deleted ones don't.
  projectsPerOrganization: 1000,
  // A member's entries in one organization that start within 24 hours of a new entry's
  // start, before or after it.
  entriesPerMemberPerDay: 200,
} as const
