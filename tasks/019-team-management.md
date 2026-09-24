# 019: Team management

Status: todo

The organization plugin creates teams and adds members to them, but it has no team
roles. `team_member.role` is an app column (`docs/architecture.md`, "Tenancy"), so only
the app can make someone a team lead. The UI also needs to list members and teams for
pickers and filters.

## Acceptance criteria

- [ ] Decided and recorded: which team and invitation operations the UI calls on Better
      Auth directly, and which go through server functions
- [ ] `setTeamRole` (lead or member), admin/owner only; the user must be on the team
- [ ] `listMembers`: the organization's members with their org role and team roles
- [ ] `listTeams`: the organization's teams with their members
- [ ] Role rules tested on a seeded throwaway database
