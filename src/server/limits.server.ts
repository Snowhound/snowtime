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

// Request rates, as { window in seconds, max requests } (src/server/rate-limit.server.ts).
export const rateLimits = {
  // Server-function writes by one user, in all organizations together. Rows save as they
  // are edited, so a fast editor makes a few a second, but not for a minute.
  writesPerUser: { window: 60, max: 120 },
  // Better Auth counts these per IP address, and everyone in an office may share one.
  createOrganization: { window: 60 * 60, max: 10 },
  inviteMember: { window: 60, max: 30 },
} as const
