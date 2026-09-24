# 03: Projects

Status: done

Archiving is reversible: `unarchiveProject` clears `archived_at`, because archiving is
lifecycle, not deletion, and a project archived by mistake would otherwise need a new
project and a new name. Repeating an archive, unarchive, assign, or unassign call changes
nothing.

## Acceptance criteria

- [x] `createProject`, `updateProject`, `archiveProject`, `unarchiveProject`
      (admin/owner); a taken name or id returns `CONFLICT`
- [x] `assignProjectToTeam`, `unassignProjectFromTeam` (admin/owner); a team or project
      outside the organization returns `NOT_FOUND`
- [x] `listProjects`: unassigned projects plus those assigned to the user's teams;
      admins/owners see all; archived ones only with `includeArchived`; each with its
      `teamIds`
- [x] `assertUsableProject` and `listProjects` share one visibility filter
- [x] Role rules tested on a seeded throwaway database (`src/server/projects.test.ts`)
