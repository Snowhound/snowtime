# 019: Team management

Status: done

The organization plugin creates teams and adds members to them, but it has no team
roles. `team_member.role` is an app column (`docs/architecture.md`, "Tenancy"), so only
the app can make someone a team lead. The UI also needs to list members and teams for
pickers and filters.

## Acceptance criteria

- [x] Decided and recorded: the UI calls Better Auth directly for teams, team membership,
      invitations, and org roles; server functions cover team roles only
- [x] `setTeamRole` (lead or member), admin/owner only; the user must be on the team
- [x] `listMembers`: the organization's members with their org role and team roles
- [x] `listTeams`: the organization's teams with their members
- [x] Role rules tested on a seeded throwaway database (`src/server/teams.test.ts`)
